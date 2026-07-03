import type { OrderRow, RequestContext, SubscriptionRow } from '../types';
import { json, errorResponse, newId, readJson } from '../lib/util';
import { runChat, type ChatMessage } from '../lib/ai';
import { getAuthUser, requireAuth } from '../lib/auth';
import { sendEmail } from '../lib/email';
import { serializeSubscription } from './subscriptions';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ESCALATE_TOKEN = '[ESCALATE]';

/** Policies the support bot is grounded in (mirrors the public FAQ). */
const POLICIES = `
STORE POLICIES:
- Shipping: orders ship in 2-3 business days, ambient (everything is shelf-stable, including ghee butters). Free shipping on orders over $45 and on all subscription boxes; $6.95 flat below $45. US only.
- Discounts: any 3+ items = 15% off automatically. First subscription box = 20% off. Promo codes entered at Stripe checkout (cannot combine with the automatic bundle discount).
- Subscriptions (Rx Box): Starter $39/4 items, Standard $54/6, Full Prescription $69/8. Cadence: monthly, every 2 months, or annual prepay (12 boxes billed once, pay for 10). Customers pick their items at /account/customize; default = best-sellers. Skip next box, pause 1-3 months, resume, or cancel anytime from /account (Manage Billing opens the Stripe portal for cancellation and card changes).
- Loyalty: 1 point per $1. Tiers: Patient (0) -> Resident (150) -> Attending (400) -> Chief of Medicine (1000).
- Storage: mayo/sauces/toppers refrigerate after opening; ghee butters shelf-stable sealed, refrigerate after opening for peak freshness; seasonings cool dry pantry.
- Allergens: products may contain eggs, dairy, soy, sesame, tree nuts — full ingredient list on every label.
- Returns/refunds: damaged or wrong items are replaced or refunded — escalate to a human with the order details. We cannot process refunds in chat.
- Clinical Trials (/trials): limited drops, subscribers get 48h early access, no restocks.
`;

/**
 * Front Desk: AI support chat grounded in policies + (when signed in) the
 * customer's own orders and subscription. Escalates to a human ticket when
 * it can't resolve something.
 */
export async function supportChat(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<{ messages?: { role: string; content: string }[] }>(req);
  const incoming = (body?.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 800) }));
  if (incoming.length === 0 || incoming[incoming.length - 1].role !== 'user') {
    return errorResponse('messages must end with a user message');
  }

  // Signed-in customers get answers about their own account.
  let accountContext = 'The customer is not signed in — you cannot see their orders. For order-specific questions, ask them to sign in or escalate.';
  const user = await getAuthUser(req, rc.env);
  if (user) {
    const { results: orders } = await rc.env.DB.prepare(
      "SELECT id, total, status, created_at FROM orders WHERE user_id = ? OR email = ? ORDER BY created_at DESC LIMIT 3"
    )
      .bind(user.id, user.email)
      .all<OrderRow>();
    const sub = await rc.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(user.id)
      .first<SubscriptionRow>();
    accountContext = `Signed-in customer: ${user.email}.
Recent orders: ${orders.length ? orders.map((o) => `#${o.id} $${(o.total / 100).toFixed(2)} ${o.status} on ${o.created_at.slice(0, 10)}`).join('; ') : 'none'}.
Subscription: ${sub ? JSON.stringify(serializeSubscription(sub)) : 'none'}.`;
  }

  const system: ChatMessage = {
    role: 'system',
    content: `You are the Front Desk at Flavor Doctors, a premium sauce brand with a playful medical theme. You handle customer support: orders, shipping, subscriptions, storage, discounts, account questions.

${POLICIES}

CUSTOMER CONTEXT:
${accountContext}

Rules:
- Answer from the policies and customer context above. Stay warm, concise (under 100 words), lightly in-character but CLEAR — support answers beat wordplay.
- Never invent order details, tracking numbers, or refunds.
- If the customer asks for a human, a refund, reports damaged/missing/wrong items, or you cannot resolve their issue from the information above, end your reply with the exact token ${ESCALATE_TOKEN} on its own line, after telling them you're bringing in the doctor (a human) and that they can leave their email to open a ticket.`,
  };

  try {
    const raw = await runChat(rc.env, [system, ...incoming], 400);
    const escalate = raw.includes(ESCALATE_TOKEN);
    const reply = raw.replaceAll(ESCALATE_TOKEN, '').trim();
    return json({ reply, escalate, signedInEmail: user?.email ?? null });
  } catch (err) {
    console.error('Support bot failed:', err);
    // The desk never dead-ends: offer the human path when AI is down.
    return json({
      reply: 'The front desk is swamped right now — but a human can help. Leave your email and question below and we’ll open a ticket.',
      escalate: true,
      signedInEmail: user?.email ?? null,
      degraded: true,
    });
  }
}

/** Create a support ticket (bot escalation or direct form). */
export async function createTicket(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<{ email?: string; subject?: string; message?: string; transcript?: string }>(req);
  const user = await getAuthUser(req, rc.env);
  const email = (user?.email ?? body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return errorResponse('A valid email is required');
  const subject = body?.subject?.trim().slice(0, 140) || 'Support request';
  const message = body?.message?.trim() ?? '';
  if (message.length < 5 || message.length > 4000) return errorResponse('Message must be 5-4000 characters');

  const id = newId('t');
  const statements = [
    rc.env.DB.prepare('INSERT INTO tickets (id, email, user_id, subject, source) VALUES (?, ?, ?, ?, ?)').bind(
      id, email, user?.id ?? null, subject, body?.transcript ? 'bot' : 'form'
    ),
    rc.env.DB.prepare("INSERT INTO ticket_messages (ticket_id, role, body) VALUES (?, 'customer', ?)").bind(id, message),
  ];
  if (body?.transcript?.trim()) {
    statements.splice(1, 0,
      rc.env.DB.prepare("INSERT INTO ticket_messages (ticket_id, role, body) VALUES (?, 'bot', ?)").bind(
        id, `Chat transcript:\n${body.transcript.trim().slice(0, 4000)}`
      )
    );
  }
  await rc.env.DB.batch(statements);

  rc.ctx.waitUntil(
    sendEmail(
      rc.env,
      email,
      `We got your message — ticket ${id}`,
      `<h2>The doctor has been paged 🩺</h2><p>Your support ticket <strong>${id}</strong> is open:</p><p style="background:#eee;padding:12px;border-radius:8px">${escapeHtml(message)}</p><p>A human will reply to this address, usually within one business day.</p>`
    )
  );
  return json({ ok: true, ticketId: id }, 201);
}

/** The signed-in customer's tickets with threads. */
export const myTickets = requireAuth(async (_req, rc) => {
  const { results: tickets } = await rc.env.DB.prepare(
    'SELECT * FROM tickets WHERE user_id = ? OR email = ? ORDER BY updated_at DESC LIMIT 20'
  )
    .bind(rc.user!.id, rc.user!.email)
    .all<{ id: string; subject: string; status: string; created_at: string }>();
  const withMessages = await Promise.all(
    tickets.map(async (t) => {
      const { results: messages } = await rc.env.DB.prepare(
        'SELECT role, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at'
      )
        .bind(t.id)
        .all<{ role: string; body: string; created_at: string }>();
      return { ...t, messages };
    })
  );
  return json({ tickets: withMessages });
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
