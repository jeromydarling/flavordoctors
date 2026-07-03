import type { Env } from '../types';

/**
 * Append a row to the audit trail. Best-effort by design — a logging
 * failure must never block the action being audited.
 */
export async function audit(env: Env, actor: string, action: string, target?: string, detail?: string): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO audit_log (actor, action, target, detail) VALUES (?, ?, ?, ?)')
      .bind(actor, action, target ?? null, detail?.slice(0, 500) ?? null)
      .run();
  } catch (err) {
    console.error('audit log write failed', err);
  }
}
