import { ROLES, type Role } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { requireAdmin, isAdminEmail } from '../lib/auth';
import { audit } from '../lib/audit';

/** Staff roster: everyone with elevated access, plus recent audit activity. */
export const listStaff = requireAdmin(async (_req, rc) => {
  const [staff, entries] = await Promise.all([
    rc.env.DB.prepare("SELECT id, email, role, created_at FROM users WHERE role != 'customer' ORDER BY role DESC, email").all<{
      id: string;
      email: string;
      role: Role;
      created_at: string;
    }>(),
    rc.env.DB.prepare('SELECT actor, action, target, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 100').all(),
  ]);
  return json({
    staff: staff.results.map((s) => ({
      ...s,
      allowlisted: isAdminEmail(s.email, rc.env), // root admins from ADMIN_EMAILS can't be locked out
    })),
    audit: entries.results,
    me: rc.user!.email,
  });
});

/** Change a user's role. Admin-only, audited, with a self-demotion guard. */
export const setStaffRole = requireAdmin(async (req, rc) => {
  const b = await readJson<{ email?: string; role?: string }>(req);
  const email = b?.email?.trim().toLowerCase();
  const role = b?.role as Role | undefined;
  if (!email || !role || !ROLES.includes(role)) {
    return errorResponse(`email and a role (${ROLES.join(', ')}) are required`);
  }
  if (email === rc.user!.email && role !== 'admin') {
    return errorResponse('You cannot demote yourself — ask another admin to do it', 400);
  }
  const target = await rc.env.DB.prepare('SELECT id, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; role: Role }>();
  if (!target) return errorResponse('No registered account with that email — they need to sign up first', 404);
  if (target.role === role) return errorResponse(`${email} already has the ${role} role`);

  await rc.env.DB.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?')
    .bind(role, role === 'admin' ? 1 : 0, target.id)
    .run();
  await audit(rc.env, rc.user!.email, 'role_change', email, `${target.role} → ${role}`);
  return json({ ok: true, email, role });
});
