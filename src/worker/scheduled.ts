import type { Env } from './types';
import { sendEmail, refillReminderEmail, winBackEmail, dropOpenEmail } from './lib/email';

const SITE_URL = 'https://flavordoctors.com';

/** Nightly cron: refill reminders, win-back emails, drop waitlist notifications. */
export async function runScheduled(env: Env): Promise<void> {
  const results = await Promise.allSettled([refillReminders(env), winBacks(env), dropNotifications(env)]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Scheduled job failed:', r.reason);
  }
}

/** Orders 30-45 days old with no newer order from the same email → "your Rx is running low". */
async function refillReminders(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.email FROM orders o
     WHERE o.email IS NOT NULL
       AND o.status IN ('paid', 'shipped', 'delivered')
       AND o.created_at <= datetime('now', '-30 days')
       AND o.created_at > datetime('now', '-45 days')
       AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.email = o.email AND o2.created_at > o.created_at)
       AND NOT EXISTS (SELECT 1 FROM sent_emails se WHERE se.email = o.email AND se.kind = 'refill' AND se.ref = o.id)
     LIMIT 25`
  ).all<{ id: string; email: string }>();

  for (const row of results) {
    await sendEmail(env, row.email, 'Your prescription is running low', refillReminderEmail(SITE_URL));
    await env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'refill', ?)")
      .bind(row.email, row.id)
      .run();
  }
  if (results.length > 0) console.log(`Refill reminders sent: ${results.length}`);
}

/** Canceled subscribers with no live subscription → one win-back per subscription. */
async function winBacks(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, u.email FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.status = 'canceled'
       AND NOT EXISTS (
         SELECT 1 FROM subscriptions s2
         WHERE s2.user_id = s.user_id AND s2.status IN ('active', 'past_due', 'paused')
       )
       AND NOT EXISTS (SELECT 1 FROM sent_emails se WHERE se.email = u.email AND se.kind = 'winback' AND se.ref = s.id)
     LIMIT 25`
  ).all<{ id: string; email: string }>();

  for (const row of results) {
    await sendEmail(env, row.email, 'The doctor misses you', winBackEmail(SITE_URL));
    await env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'winback', ?)")
      .bind(row.email, row.id)
      .run();
  }
  if (results.length > 0) console.log(`Win-back emails sent: ${results.length}`);
}

/** Waitlisted patients whose trial has opened → notify once. */
async function dropNotifications(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT w.email, w.product_id, p.name, p.slug FROM drop_waitlist w
     JOIN products p ON p.id = w.product_id
     WHERE w.notified = 0
       AND p.is_active = 1 AND p.is_drop = 1
       AND p.drop_starts_at IS NOT NULL AND p.drop_starts_at <= datetime('now')
       AND (p.drop_stock IS NULL OR p.drop_stock > 0)
     LIMIT 50`
  ).all<{ email: string; product_id: string; name: string; slug: string }>();

  for (const row of results) {
    await sendEmail(env, row.email, `Now enrolling: ${row.name}`, dropOpenEmail(row.name, row.slug, SITE_URL));
    await env.DB.prepare('UPDATE drop_waitlist SET notified = 1 WHERE email = ? AND product_id = ?')
      .bind(row.email, row.product_id)
      .run();
  }
  if (results.length > 0) console.log(`Drop notifications sent: ${results.length}`);
}
