import type { Env, RequestContext } from '../types';
import { errorResponse, newId } from '../lib/util';

/** Short HMAC so NPS links can't be forged for other people's orders. */
export async function npsSig(env: Env, orderId: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`nps:${orderId}:${email}`)));
  return [...mac.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function respond(title: string, message: string, extra = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} — Flavor Doctors</title>
<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Georgia,serif;background:#0D1B2A;color:#F5F5F5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:520px;padding:40px;text-align:center">
<div style="font-size:48px">🩺</div>
<h1 style="color:#2ECC71">${title}</h1>
<p style="font-size:18px;line-height:1.6;color:#c9d2dc">${message}</p>
${extra}
<p style="margin-top:28px"><a href="https://flavordoctors.com" style="color:#F5A623">flavordoctors.com</a></p>
</div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/**
 * One-click NPS response from the day-7 pulse email.
 * Detractors (≤6) open a ticket in the support inbox automatically;
 * promoters (≥9) get nudged toward a review and their referral link.
 */
export async function npsRespond(req: Request, rc: RequestContext): Promise<Response> {
  const url = new URL(req.url);
  const orderId = url.searchParams.get('o') ?? '';
  const email = (url.searchParams.get('e') ?? '').toLowerCase();
  const score = parseInt(url.searchParams.get('s') ?? '', 10);
  const sig = url.searchParams.get('sig') ?? '';
  if (!orderId || !email || !Number.isInteger(score) || score < 0 || score > 10) {
    return errorResponse('Invalid survey link', 400);
  }
  if (sig !== (await npsSig(rc.env, orderId, email))) return errorResponse('Invalid survey link', 400);

  const order = await rc.env.DB.prepare('SELECT id, user_id FROM orders WHERE id = ? AND email = ?')
    .bind(orderId, email)
    .first<{ id: string; user_id: string | null }>();
  if (!order) return errorResponse('Order not found', 404);

  await rc.env.DB.prepare(
    'INSERT INTO nps_responses (order_id, email, score) VALUES (?, ?, ?) ON CONFLICT (order_id) DO UPDATE SET score = excluded.score'
  )
    .bind(orderId, email, score)
    .run();

  if (score <= 6) {
    // Detractor → straight into the support inbox, once per order.
    const existing = await rc.env.DB.prepare("SELECT 1 FROM tickets WHERE subject LIKE ? LIMIT 1")
      .bind(`NPS follow-up · order ${orderId}%`)
      .first();
    if (!existing) {
      const ticketId = newId('t');
      await rc.env.DB.batch([
        rc.env.DB.prepare("INSERT INTO tickets (id, email, user_id, subject, source) VALUES (?, ?, ?, ?, 'nps')").bind(
          ticketId,
          email,
          order.user_id,
          `NPS follow-up · order ${orderId} (scored ${score}/10)`
        ),
        rc.env.DB.prepare("INSERT INTO ticket_messages (ticket_id, role, body) VALUES (?, 'bot', ?)").bind(
          ticketId,
          `Automatic follow-up: this patient rated their experience ${score}/10 on the post-delivery pulse survey. Reach out, make it right.`
        ),
      ]);
    }
    return respond(
      'We hear you — the doctor is on it',
      "That score isn't good enough for us either. A specialist is reviewing your order and will email you personally to make it right."
    );
  }
  if (score >= 9) {
    return respond(
      'Music to our stethoscopes 🎉',
      'Thank you! Two small favors that help the clinic enormously:',
      `<p style="margin-top:16px"><a href="https://flavordoctors.com/account" style="display:inline-block;background:#2ECC71;color:#0D1B2A;font-weight:800;padding:12px 22px;border-radius:10px;text-decoration:none">Leave a quick review</a></p>
       <p style="margin-top:10px"><a href="https://flavordoctors.com/account" style="color:#F5A623">Refer a friend — you both earn $5 in points →</a></p>`
    );
  }
  return respond('Thanks for the check-up', 'Noted on your chart. We keep tuning every batch — see you at the next refill.');
}
