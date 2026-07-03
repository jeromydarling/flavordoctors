import type { SubscriptionRow } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { requireStaff } from '../lib/auth';
import { audit } from '../lib/audit';
import { sendEmail } from '../lib/email';
import { serializeSubscription } from './subscriptions';

export type LifecycleStage = 'vip' | 'subscriber' | 'at_risk' | 'customer' | 'lapsed' | 'lead';

interface CustomerAgg {
  email: string;
  user_id: string | null;
  contact_created: string | null;
  marketing_consent: number | null;
  source: string | null;
  orders_count: number;
  lifetime_spend: number;
  last_order_at: string | null;
  sub_status: string | null;
  points: number;
}

function stageFor(c: CustomerAgg): LifecycleStage {
  const daysSince = c.last_order_at ? (Date.now() - Date.parse(c.last_order_at + 'Z')) / 86400000 : null;
  const liveSub = c.sub_status && ['active', 'past_due', 'paused'].includes(c.sub_status);
  if (c.lifetime_spend >= 15000 || c.orders_count >= 3) return 'vip';
  if (liveSub && c.sub_status !== 'active') return 'at_risk'; // paused / past_due subscriber
  if (liveSub) return 'subscriber';
  if (daysSince !== null && daysSince > 90) return 'lapsed';
  if (daysSince !== null && daysSince > 45) return 'at_risk';
  if (c.orders_count > 0) return 'customer';
  return 'lead';
}

const CUSTOMER_AGG_SQL = `
  WITH emails AS (
    SELECT email FROM contacts
    UNION SELECT email FROM users
    UNION SELECT email FROM orders WHERE email IS NOT NULL
  )
  SELECT e.email,
    u.id AS user_id,
    c.created_at AS contact_created,
    c.marketing_consent,
    c.source,
    COALESCE(o.n, 0) AS orders_count,
    COALESCE(o.spend, 0) AS lifetime_spend,
    o.last_order_at,
    s.status AS sub_status,
    COALESCE(pl.points, 0) AS points
  FROM emails e
  LEFT JOIN users u ON u.email = e.email
  LEFT JOIN contacts c ON c.email = e.email
  LEFT JOIN (SELECT email, COUNT(*) AS n, SUM(total) AS spend, MAX(created_at) AS last_order_at
             FROM orders WHERE status != 'canceled' GROUP BY email) o ON o.email = e.email
  LEFT JOIN (SELECT user_id, status, MAX(created_at) FROM subscriptions
             WHERE status IN ('active','past_due','paused') GROUP BY user_id) s ON s.user_id = u.id
  LEFT JOIN (SELECT user_id, SUM(delta) AS points FROM points_ledger GROUP BY user_id) pl ON pl.user_id = u.id
`;

/** Customer list with lifecycle stages and key metrics. */
export const listCustomers = requireStaff(async (req, rc) => {
  const url = new URL(req.url);
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
  const where = search ? `WHERE e.email LIKE ?` : '';
  const stmt = rc.env.DB.prepare(`${CUSTOMER_AGG_SQL} ${where} ORDER BY COALESCE(o.spend, 0) DESC, e.email LIMIT 500`);
  const { results } = await (search ? stmt.bind(`%${search}%`) : stmt).all<CustomerAgg>();
  const customers = results.map((c) => ({
    email: c.email,
    userId: c.user_id,
    stage: stageFor(c),
    ordersCount: c.orders_count,
    lifetimeSpend: c.lifetime_spend,
    lastOrderAt: c.last_order_at,
    subStatus: c.sub_status,
    points: c.points,
    consent: c.marketing_consent === 1,
    source: c.source,
    since: c.contact_created,
  }));
  const stages: Record<string, number> = {};
  for (const c of customers) stages[c.stage] = (stages[c.stage] ?? 0) + 1;
  return json({ customers, stages });
});

/** Full customer file: profile, orders, subscription, loyalty, activity, notes, tickets. */
export const customerDetail = requireStaff(async (req, rc) => {
  const email = new URL(req.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email) return errorResponse('email required');
  const db = rc.env.DB;

  const agg = await db.prepare(`${CUSTOMER_AGG_SQL} WHERE e.email = ?`).bind(email).first<CustomerAgg>();
  if (!agg) return errorResponse('Customer not found', 404);

  const [orders, sub, ledger, profile, notes, tickets, emailLog, reviews] = await Promise.all([
    db.prepare("SELECT id, total, status, created_at FROM orders WHERE email = ? ORDER BY created_at DESC LIMIT 20").bind(email).all(),
    agg.user_id
      ? db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(agg.user_id).first<SubscriptionRow>()
      : Promise.resolve(null),
    agg.user_id
      ? db.prepare('SELECT delta, reason, created_at FROM points_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').bind(agg.user_id).all()
      : Promise.resolve({ results: [] }),
    agg.user_id
      ? db.prepare('SELECT condition, updated_at FROM flavor_profiles WHERE user_id = ?').bind(agg.user_id).first()
      : Promise.resolve(null),
    db.prepare('SELECT id, author, body, created_at FROM customer_notes WHERE email = ? ORDER BY created_at DESC LIMIT 20').bind(email).all(),
    db.prepare('SELECT id, subject, status, updated_at FROM tickets WHERE email = ? ORDER BY updated_at DESC LIMIT 10').bind(email).all(),
    db.prepare('SELECT kind, ref, created_at FROM sent_emails WHERE email = ? ORDER BY created_at DESC LIMIT 10').bind(email).all(),
    agg.user_id
      ? db.prepare(`SELECT r.rating, r.body, r.approved, p.name FROM product_reviews r JOIN products p ON p.id = r.product_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 10`).bind(agg.user_id).all()
      : Promise.resolve({ results: [] }),
  ]);

  return json({
    email,
    userId: agg.user_id,
    stage: stageFor(agg),
    consent: agg.marketing_consent === 1,
    source: agg.source,
    since: agg.contact_created,
    ordersCount: agg.orders_count,
    lifetimeSpend: agg.lifetime_spend,
    points: agg.points,
    quizCondition: (profile as { condition?: string } | null)?.condition ?? null,
    orders: orders.results,
    subscription: sub ? serializeSubscription(sub) : null,
    pointsLedger: ledger.results,
    notes: notes.results,
    tickets: tickets.results,
    emailLog: emailLog.results,
    reviews: reviews.results,
  });
});

export const addNote = requireStaff(async (req, rc) => {
  const b = await readJson<{ email?: string; body?: string }>(req);
  const email = b?.email?.trim().toLowerCase();
  const noteBody = b?.body?.trim();
  if (!email || !noteBody) return errorResponse('email and body required');
  await rc.env.DB.prepare('INSERT INTO customer_notes (email, author, body) VALUES (?, ?, ?)')
    .bind(email, rc.user!.email, noteBody.slice(0, 2000))
    .run();
  return json({ ok: true });
});

export const grantPoints = requireStaff(async (req, rc) => {
  const b = await readJson<{ email?: string; delta?: number; reason?: string }>(req);
  const email = b?.email?.trim().toLowerCase();
  if (!email || !Number.isInteger(b?.delta) || b!.delta === 0 || Math.abs(b!.delta!) > 5000) {
    return errorResponse('email and a non-zero delta (max ±5000) required');
  }
  const user = await rc.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) return errorResponse('No registered account for that email — points require an account', 404);
  // The ledger has UNIQUE(reason, ref) for idempotent order/review credits;
  // manual grants are intentionally repeatable, so the ref carries a timestamp.
  await rc.env.DB.prepare("INSERT INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'bonus', ?)")
    .bind(user.id, b!.delta, `admin:${rc.user!.email}:${b?.reason ?? 'manual'}:${Date.now()}`.slice(0, 100))
    .run();
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'points_grant', email, `${b!.delta} pts (${b?.reason ?? 'manual'})`));
  return json({ ok: true });
});

export const emailCustomer = requireStaff(async (req, rc) => {
  const b = await readJson<{ email?: string; subject?: string; body?: string }>(req);
  const email = b?.email?.trim().toLowerCase();
  if (!email || !b?.subject?.trim() || !b?.body?.trim()) return errorResponse('email, subject, body required');
  await sendEmail(rc.env, email, b.subject.trim(), `<p>${b.body.trim().replace(/\n/g, '</p><p>')}</p>`);
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'customer_email', email, b.subject.trim()));
  return json({ ok: true });
});

// ---------- Support inbox ----------

export const listTickets = requireStaff(async (req, rc) => {
  const status = new URL(req.url).searchParams.get('status') ?? 'open';
  const { results } = await rc.env.DB.prepare(
    'SELECT * FROM tickets WHERE status = ? ORDER BY updated_at DESC LIMIT 100'
  )
    .bind(status === 'closed' ? 'closed' : 'open')
    .all();
  const counts = await rc.env.DB.prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status').all<{ status: string; n: number }>();
  return json({ tickets: results, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])) });
});

export const ticketDetail = requireStaff(async (_req, rc) => {
  const ticket = await rc.env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(rc.params.id).first();
  if (!ticket) return errorResponse('Ticket not found', 404);
  const { results: messages } = await rc.env.DB.prepare(
    'SELECT role, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at'
  )
    .bind(rc.params.id)
    .all();
  return json({ ticket, messages });
});

export const replyTicket = requireStaff(async (req, rc) => {
  const b = await readJson<{ body?: string }>(req);
  const replyBody = b?.body?.trim();
  if (!replyBody) return errorResponse('body required');
  const ticket = await rc.env.DB.prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(rc.params.id)
    .first<{ id: string; email: string; subject: string }>();
  if (!ticket) return errorResponse('Ticket not found', 404);

  await rc.env.DB.batch([
    rc.env.DB.prepare("INSERT INTO ticket_messages (ticket_id, role, body) VALUES (?, 'agent', ?)").bind(ticket.id, replyBody.slice(0, 4000)),
    rc.env.DB.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").bind(ticket.id),
  ]);
  rc.ctx.waitUntil(
    sendEmail(
      rc.env,
      ticket.email,
      `Re: ${ticket.subject} (ticket ${ticket.id})`,
      `<p>${replyBody.replace(/\n/g, '</p><p>')}</p><p style="color:#555;font-size:13px">Reply to this email or visit your chart at flavordoctors.com/account to continue the conversation.</p>`
    )
  );
  return json({ ok: true });
});

export const setTicketStatus = requireStaff(async (req, rc) => {
  const b = await readJson<{ status?: string }>(req);
  if (!b?.status || !['open', 'closed'].includes(b.status)) return errorResponse('status must be open or closed');
  const result = await rc.env.DB.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(b.status, rc.params.id)
    .run();
  if (result.meta.changes === 0) return errorResponse('Ticket not found', 404);
  return json({ ok: true });
});
