import type { Env } from '../types';
import { sendMarketingEmail } from './marketing';

/**
 * The paced send pipeline. Rows are claimed atomically (status flip via
 * UPDATE…RETURNING) BEFORE any network call, so two overlapping cron ticks
 * can never double-send. Error taxonomy:
 *  - permanent (bad address, provider-suppressed) → 'failed', never retried
 *  - account throttle → the WHOLE remaining batch of that broadcast is parked
 *    an hour, without burning per-row attempts
 *  - transient → backoff 15/30 min, max 3 attempts
 */

const BATCH_DEFAULT = 10;
const STALE_CLAIM_MINUTES = 15;

interface SendRow {
  id: number;
  broadcast_id: string;
  variant: string;
  email: string;
  subject: string;
  body_html: string;
  attempts: number;
}

export async function enqueueBroadcast(
  env: Env,
  broadcastId: string,
  recipients: { email: string; variant: string }[],
  subjectA: string,
  subjectB: string | null,
  bodyHtml: string
): Promise<{ queued: number; suppressed: number }> {
  let queued = 0;
  let suppressed = 0;
  for (const r of recipients) {
    const email = r.email.toLowerCase();
    // Queue-time suppression check (re-checked again at send time).
    const sup = await env.DB.prepare('SELECT email FROM mkt_suppression WHERE email = ?').bind(email).first();
    const subject = r.variant === 'b' && subjectB ? subjectB : subjectA;
    const status = sup ? 'suppressed' : 'queued';
    const res = await env.DB.prepare(
      'INSERT OR IGNORE INTO mkt_sends (broadcast_id, variant, email, subject, body_html, status) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(broadcastId, r.variant, email, subject, bodyHtml, status)
      .run();
    if (res.meta.changes > 0) sup ? suppressed++ : queued++;
  }
  return { queued, suppressed };
}

export async function drainOutbox(env: Env, origin: string, batch?: number): Promise<{ sent: number; failed: number }> {
  const n = batch ?? (parseInt(env.OUTBOX_BATCH ?? '', 10) || BATCH_DEFAULT);

  // Recover stale claims from crashed ticks.
  await env.DB.prepare(
    `UPDATE mkt_sends SET status = 'queued', claimed_at = NULL WHERE status = 'sending' AND claimed_at < datetime('now', '-${STALE_CLAIM_MINUTES} minutes')`
  ).run();

  // Atomic claim BEFORE any network call.
  const { results: rows } = await env.DB.prepare(
    `UPDATE mkt_sends SET status = 'sending', claimed_at = datetime('now')
     WHERE id IN (SELECT id FROM mkt_sends WHERE status = 'queued' AND due_at <= datetime('now') ORDER BY id LIMIT ?)
     RETURNING id, broadcast_id, variant, email, subject, body_html, attempts`
  )
    .bind(n)
    .all<SendRow>();

  let sent = 0;
  let failed = 0;
  const parkedBroadcasts = new Set<string>();

  for (const row of rows) {
    if (parkedBroadcasts.has(row.broadcast_id)) {
      await env.DB.prepare(
        "UPDATE mkt_sends SET status = 'queued', claimed_at = NULL, due_at = datetime('now', '+1 hour') WHERE id = ?"
      )
        .bind(row.id)
        .run();
      continue;
    }
    try {
      const ok = await sendMarketingEmail(env, origin, row.email, row.subject, row.body_html, {
        campaignId: row.broadcast_id,
      });
      if (ok) {
        await env.DB.prepare("UPDATE mkt_sends SET status = 'sent', sent_at = datetime('now') WHERE id = ?")
          .bind(row.id)
          .run();
        await env.DB.prepare(
          "INSERT INTO campaign_events (campaign_id, email, variant, kind) VALUES (?, ?, ?, 'sent')"
        )
          .bind(row.broadcast_id, row.email, row.variant)
          .run();
        sent++;
      } else {
        // No consent / suppressed — terminal, never retried.
        await env.DB.prepare("UPDATE mkt_sends SET status = 'suppressed' WHERE id = ?").bind(row.id).run();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const kind = classify(msg);
      if (kind === 'permanent') {
        await env.DB.prepare("UPDATE mkt_sends SET status = 'failed', last_error = ? WHERE id = ?")
          .bind(msg, row.id)
          .run();
        failed++;
      } else if (kind === 'throttle') {
        // Park this row AND the broadcast's remaining queue for an hour;
        // attempts are not burned on account-level pushback.
        parkedBroadcasts.add(row.broadcast_id);
        await env.DB.prepare(
          "UPDATE mkt_sends SET status = 'queued', claimed_at = NULL, due_at = datetime('now', '+1 hour'), last_error = ? WHERE id = ?"
        )
          .bind(msg, row.id)
          .run();
        await env.DB.prepare(
          "UPDATE mkt_sends SET due_at = datetime('now', '+1 hour') WHERE broadcast_id = ? AND status = 'queued'"
        )
          .bind(row.broadcast_id)
          .run();
      } else {
        // Transient: 15 then 30 minute backoff, three strikes total.
        if (row.attempts + 1 >= 3) {
          await env.DB.prepare(
            "UPDATE mkt_sends SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?"
          )
            .bind(msg, row.id)
            .run();
          failed++;
        } else {
          const delay = row.attempts === 0 ? '+15 minutes' : '+30 minutes';
          await env.DB.prepare(
            `UPDATE mkt_sends SET status = 'queued', claimed_at = NULL, attempts = attempts + 1, due_at = datetime('now', '${delay}'), last_error = ? WHERE id = ?`
          )
            .bind(msg, row.id)
            .run();
        }
      }
    }
  }

  // Broadcasts whose queue has fully drained flip to 'sent' with final counts.
  await env.DB.prepare(
    `UPDATE campaigns SET status = 'sent',
       sent_count = (SELECT COUNT(*) FROM mkt_sends s WHERE s.broadcast_id = campaigns.id AND s.status = 'sent')
     WHERE status = 'sending'
       AND NOT EXISTS (SELECT 1 FROM mkt_sends s2 WHERE s2.broadcast_id = campaigns.id AND s2.status IN ('queued','sending'))`
  ).run();

  return { sent, failed };
}

function classify(message: string): 'permanent' | 'throttle' | 'transient' {
  const m = message.toLowerCase();
  if (/invalid|malformed|does not exist|no such user|suppress/.test(m)) return 'permanent';
  if (/429|rate limit|too many|quota|throttl/.test(m)) return 'throttle';
  return 'transient';
}
