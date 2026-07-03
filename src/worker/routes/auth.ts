import type { RequestContext, UserRow } from '../types';
import { json, errorResponse, newId, readJson } from '../lib/util';
import { hashPassword, verifyPassword } from '../lib/password';
import { upsertContact } from '../lib/marketing';
import { signJwt } from '../lib/jwt';
import { authCookie, clearAuthCookie, isAdminEmail, requireAuth } from '../lib/auth';

interface Credentials {
  email?: string;
  password?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<Credentials>(req);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? '';
  if (!email || !EMAIL_RE.test(email)) return errorResponse('A valid email is required');
  if (password.length < 8) return errorResponse('Password must be at least 8 characters');

  const existing = await rc.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return errorResponse('An account with that email already exists', 409);

  const id = newId('u');
  const isAdmin = isAdminEmail(email, rc.env) ? 1 : 0;
  await rc.env.DB.prepare('INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)')
    .bind(id, email, await hashPassword(password), isAdmin)
    .run();
  rc.ctx.waitUntil(upsertContact(rc.env, email, { source: 'account', userId: id }));

  return sessionResponse(rc, { id, email, isAdmin: isAdmin === 1 });
}

export async function login(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<Credentials>(req);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? '';
  if (!email || !password) return errorResponse('Email and password are required');

  const user = await rc.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return errorResponse('Invalid email or password', 401);
  }

  // Keep admin status in sync with the ADMIN_EMAILS allowlist.
  let isAdmin = user.is_admin === 1;
  if (!isAdmin && isAdminEmail(email, rc.env)) {
    await rc.env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(user.id).run();
    isAdmin = true;
  }

  return sessionResponse(rc, { id: user.id, email: user.email, isAdmin });
}

export async function logout(): Promise<Response> {
  return json({ ok: true }, 200, { 'Set-Cookie': clearAuthCookie() });
}

export const me = requireAuth(async (_req, rc) => {
  return json({ user: rc.user });
});

async function sessionResponse(
  rc: RequestContext,
  user: { id: string; email: string; isAdmin: boolean }
): Promise<Response> {
  const token = await signJwt({ sub: user.id, email: user.email, adm: user.isAdmin }, rc.env.JWT_SECRET);
  return json({ user, token }, 200, { 'Set-Cookie': authCookie(token) });
}
