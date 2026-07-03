import type { RequestContext, UserRow, Role } from '../types';
import { json, errorResponse, newId, readJson } from '../lib/util';
import { hashPassword, verifyPassword } from '../lib/password';
import { upsertContact } from '../lib/marketing';
import { signJwt } from '../lib/jwt';
import { authCookie, clearAuthCookie, currentRole, isAdminEmail, requireAuth } from '../lib/auth';

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
  const role: Role = isAdminEmail(email, rc.env) ? 'admin' : 'customer';
  await rc.env.DB.prepare('INSERT INTO users (id, email, password_hash, is_admin, role) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, await hashPassword(password), role === 'admin' ? 1 : 0, role)
    .run();
  rc.ctx.waitUntil(upsertContact(rc.env, email, { source: 'account', userId: id }));

  return sessionResponse(rc, { id, email, role });
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

  // The ADMIN_EMAILS allowlist is the root of trust: anyone on it is
  // (re-)promoted to admin at login, so an accidental demotion in the staff
  // page can never lock the owner out.
  let role = user.role;
  if (role !== 'admin' && isAdminEmail(email, rc.env)) {
    await rc.env.DB.prepare("UPDATE users SET role = 'admin', is_admin = 1 WHERE id = ?").bind(user.id).run();
    role = 'admin';
  }

  return sessionResponse(rc, { id: user.id, email: user.email, role });
}

export async function logout(): Promise<Response> {
  return json({ ok: true }, 200, { 'Set-Cookie': clearAuthCookie() });
}

export const me = requireAuth(async (_req, rc) => {
  // The JWT carries the role from login time; report the live DB role so a
  // promotion or demotion is reflected in the UI without re-login.
  const role = (await currentRole(rc.env, rc.user!.id)) ?? rc.user!.role;
  return json({ user: { ...rc.user, role, isAdmin: role === 'admin' } });
});

async function sessionResponse(rc: RequestContext, user: { id: string; email: string; role: Role }): Promise<Response> {
  const isAdmin = user.role === 'admin';
  const token = await signJwt(
    { sub: user.id, email: user.email, adm: isAdmin, rol: user.role },
    rc.env.JWT_SECRET
  );
  return json({ user: { ...user, isAdmin }, token }, 200, { 'Set-Cookie': authCookie(token) });
}
