import type { Env } from '../types';

/**
 * The event spine. Emitting is fire-and-forget and idempotent: dedupe_key is
 * UNIQUE, so re-emitting the same logical event is a no-op. Consumers (the
 * social-kit generator, future lifecycle automations) drain 'pending' rows.
 */
export type MktEventKind = 'product_published' | 'drop_live' | 'back_in_stock' | 'low_stock';

export async function emitEvent(
  env: Env,
  kind: MktEventKind,
  subjectId: string,
  dedupeKey: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO mkt_events (kind, subject_id, dedupe_key, payload) VALUES (?, ?, ?, ?)'
    )
      .bind(kind, subjectId, dedupeKey, JSON.stringify(payload))
      .run();
  } catch (err) {
    // The spine must never take a product action down with it.
    console.error(`emitEvent(${kind}, ${dedupeKey}) failed:`, err);
  }
}
