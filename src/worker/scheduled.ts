import type { Env } from './types';
import { sendEmail, refillReminderEmail, winBackEmail, dropOpenEmail } from './lib/email';
import { sendMarketingEmail } from './lib/marketing';
import { committedByProduct, onHandByProduct } from './lib/inventory';
import { syncStripeCode } from './lib/affiliates';
import { refreshLibrary } from './lib/library';
import { npsSig } from './routes/nps';

import { emitEvent } from './lib/events';
import { processPendingEvents } from './lib/socialKits';

const SITE_URL = 'https://flavordoctors.com';

/**
 * Cron dispatch. The frequent trigger only drains the media-import queue;
 * the daily 16:00 UTC trigger runs the full lifecycle batch as before.
 */
export async function runScheduled(env: Env, cron?: string): Promise<void> {
  if (cron === '*/10 * * * *') {
    await processMediaImports(env).catch((e) => console.error('Media import failed:', e));
    await processPendingEvents(env).catch((e) => console.error('Social kit drain failed:', e));
    await dropLiveEvents(env).catch((e) => console.error('Drop-live sweep failed:', e));
    return;
  }
  const results = await Promise.allSettled([
    runFlows(env),
    refillReminders(env),
    winBacks(env),
    dropNotifications(env),
    lowStockAlerts(env),
    restockNotifications(env),
    npsPulse(env),
    affiliateNightly(env),
    processMediaImports(env),
    processPendingEvents(env),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('Scheduled job failed:', r.reason);
  }
}

/**
 * Drain the media-import queue: fetch each pending URL (the Worker has open
 * egress, unlike dev sandboxes) and store the bytes in R2 under cdn/, where
 * serveMedia exposes them at /cdn/*. Rows are inserted by operators only —
 * there is no public write path to this table.
 */
async function processMediaImports(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, url, r2_key FROM media_imports WHERE status = 'pending' ORDER BY id LIMIT 3"
  ).all<{ id: number; url: string; r2_key: string }>();

  for (const row of results) {
    try {
      if (!row.r2_key.startsWith('cdn/')) throw new Error('r2_key must start with cdn/');
      const res = await fetch(row.url);
      if (!res.ok) throw new Error(`Upstream responded ${res.status}`);
      const body = await res.arrayBuffer();
      if (body.byteLength > 100 * 1024 * 1024) throw new Error('File exceeds 100 MB limit');
      const contentType = res.headers.get('Content-Type') ?? 'application/octet-stream';
      await env.PRODUCT_IMAGES.put(row.r2_key, body, { httpMetadata: { contentType } });
      await env.DB.prepare(
        "UPDATE media_imports SET status = 'done', content_type = ?, size_bytes = ?, completed_at = datetime('now') WHERE id = ?"
      )
        .bind(contentType, body.byteLength, row.id)
        .run();
      console.log(`Media imported: ${row.r2_key} (${body.byteLength} bytes)`);
    } catch (e) {
      await env.DB.prepare(
        "UPDATE media_imports SET status = 'error', error = ?, completed_at = datetime('now') WHERE id = ?"
      )
        .bind(e instanceof Error ? e.message : String(e), row.id)
        .run();
      console.error(`Media import failed for ${row.r2_key}:`, e);
    }
  }
}

/**
 * Affiliate housekeeping: clear commissions past their refund window, retry
 * Stripe promo-code syncs that failed, and reconcile the resource library
 * against the live catalog (new/changed/retired products, promos).
 */
async function affiliateNightly(env: Env): Promise<void> {
  const cleared = await env.DB.prepare(
    "UPDATE affiliate_commissions SET status = 'cleared' WHERE status = 'pending' AND clears_at <= datetime('now')"
  ).run();
  if (cleared.meta.changes > 0) console.log(`Affiliate commissions cleared: ${cleared.meta.changes}`);

  const { results: unsynced } = await env.DB.prepare(
    "SELECT id, code FROM affiliates WHERE status = 'approved' AND code_synced = 0 AND code IS NOT NULL LIMIT 10"
  ).all<{ id: string; code: string }>();
  for (const aff of unsynced) await syncStripeCode(env, aff);

  const library = await refreshLibrary(env);
  if (library.generated > 0 || library.removed > 0) {
    console.log(`Library refreshed: ${library.generated} kits regenerated, ${library.removed} removed`);
  }
}

/** Back-in-stock: alert signups whose product is active and back above zero. */
async function restockNotifications(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT a.email, a.product_id, p.name, p.slug FROM restock_alerts a
     JOIN products p ON p.id = a.product_id
     JOIN (SELECT product_id, SUM(delta) AS on_hand FROM inventory_moves GROUP BY product_id) inv
       ON inv.product_id = a.product_id
     WHERE a.notified = 0 AND p.is_active = 1 AND inv.on_hand > 0
     LIMIT 50`
  ).all<{ email: string; product_id: string; name: string; slug: string }>();
  const day = new Date().toISOString().slice(0, 10);
  for (const pid of new Set(results.map((r) => r.product_id))) {
    await emitEvent(env, 'back_in_stock', pid, `back_in_stock:${pid}:${day}`);
  }

  for (const row of results) {
    await sendEmail(
      env,
      row.email,
      `Back in stock: ${row.name}`,
      `<h2>Your prescription is ready for pickup</h2><p><strong>${row.name}</strong> is back on the shelf — and these batches have a habit of disappearing.</p><p><a href="${SITE_URL}/product/${row.slug}" style="color:#27AE60;font-weight:bold;">Fill it now →</a></p>`
    );
    await env.DB.prepare('UPDATE restock_alerts SET notified = 1 WHERE email = ? AND product_id = ?')
      .bind(row.email, row.product_id)
      .run();
  }
  if (results.length > 0) console.log(`Restock notifications sent: ${results.length}`);
}

/** Day-7 NPS pulse: one question, one click, one email per order. */
async function npsPulse(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.email FROM orders o
     WHERE o.email IS NOT NULL AND o.status IN ('paid', 'shipped', 'delivered')
       AND o.created_at <= datetime('now', '-7 days')
       AND o.created_at > datetime('now', '-14 days')
       AND NOT EXISTS (SELECT 1 FROM sent_emails se WHERE se.email = o.email AND se.kind = 'nps' AND se.ref = o.id)
       AND NOT EXISTS (SELECT 1 FROM sent_emails se2 WHERE se2.email = o.email AND se2.kind = 'nps'
                       AND se2.created_at > datetime('now', '-60 days'))
     LIMIT 25`
  ).all<{ id: string; email: string }>();

  for (const row of results) {
    const sig = await npsSig(env, row.id, row.email);
    const link = (s: number) =>
      `${SITE_URL}/nps?o=${encodeURIComponent(row.id)}&e=${encodeURIComponent(row.email)}&s=${s}&sig=${sig}`;
    const buttons = Array.from({ length: 11 }, (_, s) => {
      const color = s <= 6 ? '#c0392b' : s <= 8 ? '#F5A623' : '#27AE60';
      return `<a href="${link(s)}" style="display:inline-block;width:34px;line-height:34px;text-align:center;margin:2px;background:${color};color:#fff;font-weight:bold;border-radius:6px;text-decoration:none">${s}</a>`;
    }).join('');
    await sendEmail(
      env,
      row.email,
      'Quick check-up: how did the treatment go?',
      `<h2>One-question follow-up visit</h2>
       <p>Your order arrived about a week ago. On a scale of 0–10, how likely are you to recommend Flavor Doctors to a friend with chronically boring dinners?</p>
       <div style="margin:16px 0">${buttons}</div>
       <p style="color:#777;font-size:13px">0 = never · 10 = already texting them about it. One tap is all it takes.</p>`
    );
    await env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'nps', ?)")
      .bind(row.email, row.id)
      .run();
  }
  if (results.length > 0) console.log(`NPS pulses sent: ${results.length}`);
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
  const weekRef = `${now.getUTCFullYear()}-w${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
  for (const r of low) {
    // Honest urgency only: still purchasable, genuinely low — never "sold out" hype.
    if (r.available > 0) await emitEvent(env, 'low_stock', r.id, `low_stock:${r.id}:${weekRef}`);
  }
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

/** Drops whose start time has passed fire a one-time drop_live event. */
async function dropLiveEvents(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, name FROM products WHERE is_drop = 1 AND is_active = 1 AND drop_starts_at IS NOT NULL AND drop_starts_at <= datetime('now') AND (drop_stock IS NULL OR drop_stock > 0)"
  ).all<{ id: string; name: string }>();
  for (const p of results) {
    await emitEvent(env, 'drop_live', p.id, `drop_live:${p.id}`, { name: p.name });
  }
}
