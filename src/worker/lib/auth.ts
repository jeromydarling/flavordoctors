import type { Env, AuthUser, RequestContext, Role } from '../types';
import { verifyJwt } from './jwt';
import { errorResponse } from './util';
import type { Handler } from '../router';

export const AUTH_COOKIE = 'fd_token';

export function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.get('Cookie');
  if (cookie) {
    for (const part of cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === AUTH_COOKIE) return rest.join('=');
    }
  }
  return null;
}

export async function getAuthUser(req: Request, env: Env): Promise<AuthUser | null> {
  const token = extractToken(req);
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  const role = (payload.rol as Role | undefined) ?? (payload.adm ? 'admin' : 'customer');
  return { id: payload.sub, email: payload.email, isAdmin: payload.adm, role };
}

export function authCookie(token: string, maxAge = 60 * 60 * 24 * 30): string {
  return `${AUTH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearAuthCookie(): string {
  return `${AUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Wrap a handler so it requires a logged-in user (sets rc.user). */
export function requireAuth(handler: Handler): Handler {
  return async (req: Request, rc: RequestContext) => {
    const user = await getAuthUser(req, rc.env);
    if (!user) return errorResponse('Authentication required', 401);
    return handler(req, { ...rc, user });
  };
}

/**
 * The role stored in the JWT is a snapshot from login time. Staff routes
 * re-read it from the DB so promotions and demotions apply on the next
 * request, not the next login.
 */
export async function currentRole(env: Env, userId: string): Promise<Role | null> {
  const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: Role }>();
  return row?.role ?? null;
}

/** Wrap a handler so it requires staff (support rep or admin). */
export function requireStaff(handler: Handler): Handler {
  return requireAuth(async (req, rc) => {
    const role = await currentRole(rc.env, rc.user!.id);
    if (role !== 'admin' && role !== 'support') return errorResponse('Staff access required', 403);
    return handler(req, { ...rc, user: { ...rc.user!, role, isAdmin: role === 'admin' } });
  });
}

/** Wrap a handler so it requires an admin user. */
export function requireAdmin(handler: Handler): Handler {
  return requireAuth(async (req, rc) => {
    const role = await currentRole(rc.env, rc.user!.id);
    if (role !== 'admin') return errorResponse('Admin access required', 403);
    return handler(req, { ...rc, user: { ...rc.user!, role, isAdmin: true } });
  });
}

export function isAdminEmail(email: string, env: Env): boolean {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
