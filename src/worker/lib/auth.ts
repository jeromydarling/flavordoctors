import type { Env, AuthUser, RequestContext } from '../types';
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
  return { id: payload.sub, email: payload.email, isAdmin: payload.adm };
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

/** Wrap a handler so it requires an admin user. */
export function requireAdmin(handler: Handler): Handler {
  return requireAuth(async (req, rc) => {
    if (!rc.user?.isAdmin) return errorResponse('Admin access required', 403);
    return handler(req, rc);
  });
}

export function isAdminEmail(email: string, env: Env): boolean {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
