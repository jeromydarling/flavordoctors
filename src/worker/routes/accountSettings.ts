import type { RequestContext, UserRow } from '../types';
import { LIVE_SUB_STATUSES } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { hashPassword, verifyPassword } from '../lib/password';
import { requireAuth, clearAuthCookie } from '../lib/auth';
import { sendEmail } from '../lib/email';
import { upsertContact } from '../lib/marketing';
import { audit } from '../lib/audit';

const RESET_TTL_MS = 60 * 60 * 1000; // reset links live for 1 hour

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function siteOrigin(req: Request, canonicalHost?: string): string {
  return canonicalHost ? `https://${canonicalHost}` : new URL(req.url).origin;
}

/**
 * Start a password reset. Always answers 200 with the same body so the
 * endpoint can't be used to probe which emails have accounts.
 */
export async function forgotPassword(req: Request, rc: RequestContext): Promise<Response> {
  const b = await readJson<{ email?: string }>(req);
  const email = b?.email?.trim().toLowerCase();
  const generic = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  if (!email) return json(generic);

  const user = await rc.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) return json(generic);

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  await rc.env.DB.prepare('INSERT INTO password_resets (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), email, new Date(Date.now() + RESET_TTL_MS).toISOString())
    .run();

  const link = `${siteOrigin(req, rc.env.CANONICAL_HOST)}/reset-password?token=${token}`;
  rc.ctx.waitUntil(
    sendEmail(
      rc.env,
      email,
      'Reset your Flavor Doctors password',
      `<h2>Password reset requested</h2>
       <p>Click the link below within the next hour to choose a new password. If you didn't ask for this, ignore this email — your password is unchanged.</p>
       <p><a href="${link}">Reset my password</a></p>`
    )
  );

  // Local/E2E escape hatch: never set E2E_EXPOSE_TOKENS in production.
  if (rc.env.E2E_EXPOSE_TOKENS === '1') return json({ ...generic, devToken: token });
  return json(generic);
}

/** Finish a reset: consume the token, set the new password. */
export async function resetPassword(req: Request, rc: RequestContext): Promise<Response> {
  const b = await readJson<{ token?: string; password?: string }>(req);
  if (!b?.token) return errorResponse('token required');
  if (!b.password || b.password.length < 8) return errorResponse('Password must be at least 8 characters');

  const row = await rc.env.DB.prepare(
    "SELECT email FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')"
  )
    .bind(await sha256Hex(b.token))
    .first<{ email: string }>();
  if (!row) return errorResponse('That reset link is invalid or has expired — request a new one', 400);

  await rc.env.DB.batch([
    rc.env.DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(await hashPassword(b.password), row.email),
    // Burn every outstanding token for this email, not just the one used.
    rc.env.DB.prepare('UPDATE password_resets SET used = 1 WHERE email = ?').bind(row.email),
  ]);
  return json({ ok: true });
}

/** Change password while signed in (requires the current one). */
export const changePassword = requireAuth(async (req, rc) => {
  const b = await readJson<{ currentPassword?: string; newPassword?: string }>(req);
  if (!b?.newPassword || b.newPassword.length < 8) return errorResponse('New password must be at least 8 characters');
  const user = await rc.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(rc.user!.id)
    .first<{ password_hash: string }>();
  if (!user || !(await verifyPassword(b.currentPassword ?? '', user.password_hash))) {
    return errorResponse('Current password is incorrect', 401);
  }
  await rc.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(b.newPassword), rc.user!.id)
    .run();
  return json({ ok: true });
});

export const getSettings = requireAuth(async (_req, rc) => {
  const [user, contact] = await Promise.all([
    rc.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(rc.user!.id).first<{ name: string | null }>(),
    rc.env.DB.prepare('SELECT marketing_consent FROM contacts WHERE email = ?')
      .bind(rc.user!.email)
      .first<{ marketing_consent: number }>(),
  ]);
  return json({
    email: rc.user!.email,
    name: user?.name ?? '',
    marketingConsent: contact ? contact.marketing_consent === 1 : false,
  });
});

export const updateSettings = requireAuth(async (req, rc) => {
  const b = await readJson<{ name?: string; marketingConsent?: boolean }>(req);
  if (!b) return errorResponse('Invalid JSON body');
  if (typeof b.name === 'string') {
    await rc.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?')
      .bind(b.name.trim().slice(0, 80) || null, rc.user!.id)
      .run();
  }
  if (typeof b.marketingConsent === 'boolean') {
    await upsertContact(rc.env, rc.user!.email, { userId: rc.user!.id, source: 'account' });
    await rc.env.DB.prepare('UPDATE contacts SET marketing_consent = ? WHERE email = ?')
      .bind(b.marketingConsent ? 1 : 0, rc.user!.email)
      .run();
  }
  return json({ ok: true });
});

/**
 * Self-service account deletion. Orders are kept (anonymized to the email on
 * record — required for accounting), everything personal goes: profile,
 * points, reviews, marketing contact, and the account itself.
 */
export const deleteAccount = requireAuth(async (req, rc) => {
  const b = await readJson<{ password?: string }>(req);
  const user = await rc.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(rc.user!.id).first<UserRow>();
  if (!user || !(await verifyPassword(b?.password ?? '', user.password_hash))) {
    return errorResponse('Password is incorrect', 401);
  }
  const placeholders = LIVE_SUB_STATUSES.map(() => '?').join(',');
  const liveSub = await rc.env.DB.prepare(
    `SELECT id FROM subscriptions WHERE user_id = ? AND status IN (${placeholders})`
  )
    .bind(user.id, ...LIVE_SUB_STATUSES)
    .first();
  if (liveSub) {
    return errorResponse('You have an active Rx Box — cancel it under Manage Billing first, then delete your account', 409);
  }

  await rc.env.DB.batch([
    rc.env.DB.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?').bind(user.id),
    rc.env.DB.prepare('DELETE FROM points_ledger WHERE user_id = ?').bind(user.id),
    rc.env.DB.prepare('DELETE FROM flavor_profiles WHERE user_id = ?').bind(user.id),
    rc.env.DB.prepare('DELETE FROM product_ratings WHERE user_id = ?').bind(user.id),
    rc.env.DB.prepare('DELETE FROM product_reviews WHERE user_id = ?').bind(user.id),
    rc.env.DB.prepare('DELETE FROM contacts WHERE email = ?').bind(user.email),
    rc.env.DB.prepare('DELETE FROM password_resets WHERE email = ?').bind(user.email),
    rc.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  rc.ctx.waitUntil(audit(rc.env, user.email, 'account_delete', user.email, 'self-service'));
  return json({ ok: true }, 200, { 'Set-Cookie': clearAuthCookie() });
});
