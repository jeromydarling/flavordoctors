import type { Env } from './types';
import { sendEmail, refillReminderEmail, winBackEmail, dropOpenEmail } from './lib/email';
import { sendMarketingEmail } from './lib/marketing';
import { committedByProduct, onHandByProduct } from './lib/inventory';

const SITE_URL = 'https://flavordoctors.com';

/** Nightly cron: lifecycle flows, refill reminders, win-backs, drop notifications, low-stock alerts. */
export async function runScheduled(env: Env): Promise<void> {
  const results = await Promise.allSettled([
    runFlows(env),
    refillReminders(env),
    winBacks(env),
    dropNotifications(env),
    lowStockAlerts(env),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Scheduled job failed:', r.reason);
  }
}

/**
 * SKUs whose available stock (on-hand minus units committed to upcoming
 * subscription boxes) is at or below the reorder point → one summary email
 * to the owner, at most once per ISO week. Untracked SKUs (no inventory
 * moves yet) don't alert.
 */
async function lowStockAlerts(env: Env): Promise<void> {
  const admin = (env.ADMIN_EMAILS ?? '').split(',')[0]?.trim();
  if (!admin) return;

  const [rows, committed] = await Promise.all([onHandByProduct(env), committedByProduct(env)]);
  const low = rows
    .filter((r) => r.on_hand !== null)
    .map((r) => ({ ...r, committed: committed.get(r.id) ?? 0, available: (r.on_hand ?? 0) - (committed.get(r.id) ?? 0) }))
    .filter((r) => r.available <= r.reorder_point);
  if (low.length === 0) return;

  const now = new Date();
  const week = Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  const ref = `${now.getUTCFullYear()}-w${week}`;
  const sent = await env.DB.prepare("SELECT 1 FROM sent_emails WHERE email = ? AND kind = 'low_stock' AND ref = ?")
    .bind(admin, ref)
    .first();
  if (sent) return;

  const list = low
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px">${r.name}</td><td style="padding:6px 12px;text-align:right">${r.on_hand}</td><td style="padding:6px 12px;text-align:right">${r.committed}</td><td style="padding:6px 12px;text-align:right;font-weight:bold;color:${r.available < 0 ? '#c0392b' : '#b8860b'}">${r.available}</td><td style="padding:6px 12px;text-align:right">${r.reorder_point}</td></tr>`
    )
    .join('');
  await sendEmail(
    env,
    admin,
    `Low stock: ${low.length} SKU${low.length === 1 ? '' : 's'} at or below reorder point`,
    `<h2>Time to call the co-packer</h2>
     <p>Available = on-hand minus units already committed to upcoming subscription boxes.</p>
     <table style="border-collapse:collapse"><tr><th style="padding:6px 12px;text-align:left">Product</th><th style="padding:6px 12px">On hand</th><th style="padding:6px 12px">Committed</th><th style="padding:6px 12px">Available</th><th style="padding:6px 12px">Reorder at</th></tr>${list}</table>
     <p><a href="${SITE_URL}/admin/inventory">Open the inventory board</a></p>`
  );
  await env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'low_stock', ?)")
    .bind(admin, ref)
    .run();
  console.log(`Low-stock alert sent for ${low.length} SKUs (${ref})`);
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
