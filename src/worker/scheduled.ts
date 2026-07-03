import type { Env } from './types';
import { sendEmail, refillReminderEmail, winBackEmail, dropOpenEmail } from './lib/email';
import { sendMarketingEmail } from './lib/marketing';

const SITE_URL = 'https://flavordoctors.com';

/** Nightly cron: lifecycle flows, refill reminders, win-backs, drop notifications. */
export async function runScheduled(env: Env): Promise<void> {
  const results = await Promise.allSettled([runFlows(env), refillReminders(env), winBacks(env), dropNotifications(env)]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Scheduled job failed:', r.reason);
  }
}

interface FlowRow {
  key: string;
  trigger: string;
  delay_days: number;
  subject: string;
  body_html: string;
}

/** Editable lifecycle flows: pre-launch drips on contact age, post-purchase on order age. */
async function runFlows(env: Env): Promise<void> {
  const { results: flows } = await env.DB.prepare('SELECT * FROM flows WHERE enabled = 1').all<FlowRow>();
  let sent = 0;
  for (const flow of flows) {
    if (flow.trigger === 'contact_created') {
      const { results } = await env.DB.prepare(
        `SELECT c.email FROM contacts c
         WHERE c.marketing_consent = 1
           AND (c.source LIKE 'landing:%' OR c.source = 'waitlist')
           AND c.created_at <= datetime('now', ?)
           AND NOT EXISTS (SELECT 1 FROM sent_emails se WHERE se.email = c.email AND se.kind = 'flow' AND se.ref = ?)
         LIMIT 50`
      )
        .bind(`-${flow.delay_days} days`, flow.key)
        .all<{ email: string }>();
      for (const row of results) {
        const ok = await sendMarketingEmail(env, SITE_URL, row.email, flow.subject, flow.body_html);
        await env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'flow', ?)")
          .bind(row.email, flow.key)
          .run();
        if (ok) sent++;
      }
    } else if (flow.trigger === 'order_created') {
      const { results } = await env.DB.prepare(
        `SELECT o.id, o.email FROM orders o
         WHERE o.email IS NOT NULL AND o.status IN ('paid', 'shipped', 'delivered')
           AND o.created_at <= datetime('now', ?)
           AND o.created_at > datetime('now', ?)
           AND NOT EXISTS (SELECT 1 FROM sent_emails se WHERE se.email = o.email AND se.kind = 'flow' AND se.ref = ? || ':' || o.id)
         LIMIT 50`
      )
        .bind(`-${flow.delay_days} days`, `-${flow.delay_days + 14} days`, flow.key)
        .all<{ id: string; email: string }>();
      for (const row of results) {
        const ok = await sendMarketingEmail(env, SITE_URL, row.email, flow.subject, flow.body_html);
        await env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'flow', ?)")
          .bind(row.email, `${flow.key}:${row.id}`)
          .run();
        if (ok) sent++;
      }
    }
  }
  if (sent > 0) console.log(`Flow emails sent: ${sent}`);
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
