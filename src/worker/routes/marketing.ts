import type { ProductRow, RequestContext } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { upsertContact, sendMarketingEmail, type ContactRow } from '../lib/marketing';
import { ensureCoupon, stripeRequest } from '../lib/stripe';
import { requireAuth } from '../lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFERRAL_REWARD_AT = 3;

/** Waitlist / list signup (from landing pages, footer, anywhere). */
export async function joinList(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<{ email?: string; source?: string; ref?: string; utm?: Record<string, string> }>(req);
  const email = body?.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return errorResponse('A valid email is required');
  const source = /^[a-z0-9:_-]{1,40}$/.test(body?.source ?? '') ? body!.source! : 'waitlist';
  const referredBy = /^[A-Z2-9]{6}$/.test(body?.ref ?? '') ? body!.ref! : undefined;

  await upsertContact(rc.env, email, { source, referredBy, utm: body?.utm });
  if (source.startsWith('landing:')) {
    await rc.env.DB.prepare('UPDATE landing_pages SET signups = signups + 1 WHERE slug = ?')
      .bind(source.slice('landing:'.length))
      .run();
  }

  const contact = await rc.env.DB.prepare('SELECT * FROM contacts WHERE email = ?').bind(email).first<ContactRow>();

  // Referral reward: when a referrer hits the threshold, email them a code.
  if (referredBy) {
    rc.ctx.waitUntil(maybeRewardReferrer(rc, referredBy));
  }

  return json({ ok: true, refCode: contact?.ref_code ?? null });
}

async function maybeRewardReferrer(rc: RequestContext, refCode: string): Promise<void> {
  try {
    const referrer = await rc.env.DB.prepare('SELECT * FROM contacts WHERE ref_code = ?')
      .bind(refCode)
      .first<ContactRow>();
    if (!referrer) return;
    const count = await rc.env.DB.prepare('SELECT COUNT(*) AS n FROM contacts WHERE referred_by = ?')
      .bind(refCode)
      .first<{ n: number }>();
    if ((count?.n ?? 0) < REFERRAL_REWARD_AT) return;
    const already = await rc.env.DB.prepare(
      "SELECT 1 FROM sent_emails WHERE email = ? AND kind = 'referral_reward' AND ref = ?"
    )
      .bind(referrer.email, refCode)
      .first();
    if (already) return;

    await ensureCoupon(rc.env, 'FD_REFERRAL_15', 15, 'Referral reward — 15% off');
    try {
      await stripeRequest(rc.env, 'POST', '/v1/promotion_codes', {
        coupon: 'FD_REFERRAL_15',
        code: `HOUSECALL-${refCode}`,
        max_redemptions: 1,
      });
    } catch (err) {
      console.error('Referral promo code creation failed (may already exist):', err);
    }
    const origin = 'https://flavordoctors.com';
    await sendMarketingEmail(
      rc.env,
      origin,
      referrer.email,
      'Your referrals came through — reward unlocked 🩺',
      `<h2>Three friends admitted to the clinic!</h2><p>Your referral code worked its magic. Here's a one-time <strong>15% off</strong> code for your next order:</p><p style="font-size:22px;font-weight:bold;letter-spacing:2px;">HOUSECALL-${refCode}</p><p><a href="${origin}/menu" style="color:#27AE60;font-weight:bold;">Redeem at checkout →</a></p>`
    );
    await rc.env.DB.prepare("INSERT OR IGNORE INTO sent_emails (email, kind, ref) VALUES (?, 'referral_reward', ?)")
      .bind(referrer.email, refCode)
      .run();
  } catch (err) {
    console.error('Referral reward check failed:', err);
  }
}

/** One-click unsubscribe (GET renders confirmation; POST for List-Unsubscribe-Post). */
export async function unsubscribe(req: Request, rc: RequestContext): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!token) return errorResponse('Missing token', 400);

  // GET only LOOKS UP the token and renders a confirm page — mail scanners
  // prefetch links, so the state change happens exclusively on POST
  // (both the confirm form and RFC 8058 one-click land here).
  let found: boolean;
  if (req.method === 'POST') {
    const contact = await rc.env.DB.prepare('SELECT email FROM contacts WHERE unsub_token = ?')
      .bind(token)
      .first<{ email: string }>();
    found = !!contact;
    if (contact) {
      await rc.env.DB.prepare('UPDATE contacts SET marketing_consent = 0 WHERE unsub_token = ?').bind(token).run();
      await rc.env.DB.prepare("INSERT OR IGNORE INTO mkt_suppression (email, reason) VALUES (?, 'unsubscribe')")
        .bind(contact.email.toLowerCase())
        .run();
    }
    const accept = req.headers.get('Accept') ?? '';
    const isForm = (req.headers.get('Content-Type') ?? '').includes('form') && accept.includes('text/html');
    if (!isForm) return json({ ok: found });
    // fall through to render the confirmation page for the browser form post
  } else {
    const contact = await rc.env.DB.prepare('SELECT email FROM contacts WHERE unsub_token = ?')
      .bind(token)
      .first<{ email: string }>();
    if (contact) {
      const confirm = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unsubscribe — Flavor Doctors</title>
<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Georgia,serif;background:#0D1B2A;color:#F5F5F5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:480px;padding:40px;text-align:center">
<div style="font-size:48px">🩺</div>
<h1 style="color:#F5A623">Leaving the clinic?</h1>
<p style="font-size:18px;line-height:1.6;color:#c9d2dc">Confirm below and we'll stop sending marketing email to <strong>${contact.email.replace(/</g, '&lt;')}</strong>. Order and account emails still arrive.</p>
<form method="post" action="/unsubscribe?token=${encodeURIComponent(token)}">
<button type="submit" style="background:#2ECC71;color:#0D1B2A;font-weight:bold;font-size:17px;padding:14px 28px;border:0;border-radius:10px;cursor:pointer">Confirm unsubscribe</button>
</form>
<p style="margin-top:16px"><a href="https://flavordoctors.com" style="color:#F5A623">Never mind — back to the pharmacy</a></p>
</div></body></html>`;
      return new Response(confirm, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    found = false;
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unsubscribed — Flavor Doctors</title>
<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Georgia,serif;background:#0D1B2A;color:#F5F5F5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:480px;padding:40px;text-align:center">
<div style="font-size:48px">🩺</div>
<h1 style="color:#2ECC71">${found ? "You've been discharged" : 'Link expired'}</h1>
<p style="font-size:18px;line-height:1.6;color:#c9d2dc">${
    found
      ? "No more marketing emails from Flavor Doctors. Order and account emails will still reach you. If your dinner relapses into blandness, you know where to find us."
      : 'This unsubscribe link is invalid or was already used.'
  }</p>
<a href="https://flavordoctors.com" style="color:#F5A623">flavordoctors.com</a>
</div></body></html>`;
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Open-tracking pixel. */
export async function trackOpen(req: Request, rc: RequestContext): Promise<Response> {
  const url = new URL(req.url);
  const campaign = url.searchParams.get('c');
  const email = url.searchParams.get('e');
  if (campaign && email) {
    rc.ctx.waitUntil(
      rc.env.DB.prepare("INSERT INTO campaign_events (campaign_id, email, kind) VALUES (?, ?, 'open')")
        .bind(campaign, email)
        .run()
    );
  }
  // 1x1 transparent GIF
  const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
  return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } });
}

/** Click-tracking redirect. */
export async function trackClick(req: Request, rc: RequestContext): Promise<Response> {
  const url = new URL(req.url);
  const campaign = url.searchParams.get('c');
  const email = url.searchParams.get('e');
  const target = url.searchParams.get('u') ?? '';
  if (!/^https:\/\//.test(target)) return errorResponse('Invalid target', 400);
  if (campaign && email) {
    rc.ctx.waitUntil(
      rc.env.DB.prepare("INSERT INTO campaign_events (campaign_id, email, kind, url) VALUES (?, ?, 'click', ?)")
        .bind(campaign, email, target.slice(0, 500))
        .run()
    );
  }
  return Response.redirect(target, 302);
}

/** The currently-active promotion (for the storefront banner). */
export async function activePromo(_req: Request, rc: RequestContext): Promise<Response> {
  const promo = await rc.env.DB.prepare(
    `SELECT code, percent_off, banner_text, ends_at FROM promotions
     WHERE is_active = 1 AND starts_at <= datetime('now') AND ends_at > datetime('now')
     ORDER BY starts_at DESC LIMIT 1`
  ).first<{ code: string; percent_off: number; banner_text: string | null; ends_at: string }>();
  if (!promo) return json({ promo: null });
  return json({
    promo: {
      code: promo.code,
      percentOff: promo.percent_off,
      bannerText: promo.banner_text ?? `${promo.percent_off}% off with code ${promo.code}`,
      endsAt: promo.ends_at,
    },
  });
}

/** Server-rendered landing page (campaign traffic; noindex). */
export async function landingPage(_req: Request, rc: RequestContext): Promise<Response> {
  const page = await rc.env.DB.prepare('SELECT * FROM landing_pages WHERE slug = ? AND is_active = 1')
    .bind(rc.params.slug)
    .first<{ slug: string; title: string; headline: string; body: string; cta: string; offer: string | null }>();
  if (!page) return errorResponse('Not found', 404);
  const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(page.title)} — Flavor Doctors</title>
<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Georgia,serif;background:#0D1B2A;color:#F5F5F5;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:560px;padding:48px 32px;text-align:center}
h1{font-size:42px;line-height:1.1;margin:16px 0}
p{font-size:18px;line-height:1.6;color:#c9d2dc}
.offer{display:inline-block;border:2px dashed #2ECC71;border-radius:999px;padding:8px 20px;color:#2ECC71;font-weight:bold;margin:12px 0}
form{display:flex;gap:8px;margin-top:24px}
input{flex:1;padding:14px 16px;border-radius:8px;border:2px solid #1F3A57;background:#16293F;color:#F5F5F5;font-size:16px}
button{padding:14px 22px;border-radius:8px;border:0;background:#2ECC71;color:#0D1B2A;font-weight:800;font-size:16px;cursor:pointer}
.ok{background:#16293F;border-radius:12px;padding:20px;margin-top:24px;display:none}
.ref{font-size:20px;color:#F5A623;font-weight:bold}
small{color:#7d8b9a}
</style></head><body><div class="card">
<div style="font-size:52px">🩺</div>
<h1>${esc(page.headline)}</h1>
<p>${esc(page.body)}</p>
${page.offer ? `<div class="offer">${esc(page.offer)}</div>` : ''}
<form id="f"><input type="email" id="email" placeholder="you@example.com" required>
<button type="submit">${esc(page.cta)}</button></form>
<div class="ok" id="ok"><p><strong>You're on the list.</strong> Refer 3 friends with your personal link and earn 15% off your first order:</p>
<p class="ref" id="reflink"></p></div>
<small>No spam. Unsubscribe anytime. · Flavor Doctors</small>
</div>
<script>
const params = new URLSearchParams(location.search);
const utm = {}; for (const k of ['utm_source','utm_medium','utm_campaign']) if (params.get(k)) utm[k] = params.get(k);
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email: document.getElementById('email').value, source: 'landing:${page.slug}', ref: params.get('ref') || undefined, utm }) });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('f').style.display = 'none';
    document.getElementById('ok').style.display = 'block';
    document.getElementById('reflink').textContent = location.origin + '/lp/${page.slug}?ref=' + (data.refCode || '');
  } else { alert(data.error || 'Something went wrong'); }
});
</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// --- Written reviews ---

export const submitReview = requireAuth(async (req, rc) => {
  const body = await readJson<{ rating?: number; body?: string }>(req);
  const rating = body?.rating;
  const text = body?.body?.trim() ?? '';
  if (!Number.isInteger(rating) || rating! < 1 || rating! > 5) return errorResponse('rating must be 1-5');
  if (text.length < 10 || text.length > 2000) return errorResponse('Review must be 10-2000 characters');
  const product = await rc.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(rc.params.id).first();
  if (!product) return errorResponse('Product not found', 404);

  await rc.env.DB.batch([
    rc.env.DB.prepare(
      `INSERT INTO product_reviews (user_id, product_id, rating, body) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, product_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, approved = 0, created_at = datetime('now')`
    ).bind(rc.user!.id, rc.params.id, rating, text),
    rc.env.DB.prepare(
      `INSERT INTO product_ratings (user_id, product_id, rating) VALUES (?, ?, ?)
       ON CONFLICT (user_id, product_id) DO UPDATE SET rating = excluded.rating`
    ).bind(rc.user!.id, rc.params.id, rating),
  ]);
  return json({ ok: true, pendingApproval: true });
});

export async function listReviews(_req: Request, rc: RequestContext): Promise<Response> {
  const product = await rc.env.DB.prepare('SELECT id FROM products WHERE slug = ?')
    .bind(rc.params.slug)
    .first<{ id: string }>();
  if (!product) return errorResponse('Product not found', 404);
  const { results } = await rc.env.DB.prepare(
    `SELECT r.rating, r.body, r.created_at, u.email FROM product_reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.product_id = ? AND r.approved = 1 ORDER BY r.created_at DESC LIMIT 25`
  )
    .bind(product.id)
    .all<{ rating: number; body: string; created_at: string; email: string }>();
  return json({
    reviews: results.map((r) => ({
      rating: r.rating,
      body: r.body,
      createdAt: r.created_at,
      author: maskEmail(r.email),
    })),
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain?.[0] ?? ''}…`;
}

/** Starter Pack sampler: one hero item per collection at a flat bundle price. */
const STARTER_PACK_SLUGS = ['ranch-rx', 'miso-doctor', 'big-doc-sauce', 'bourbon-street-drizzle', 'truffle-tremor'];
const STARTER_PACK_PRICE = 4900;

export async function starterPackCheckout(req: Request, rc: RequestContext): Promise<Response> {
  const placeholders = STARTER_PACK_SLUGS.map(() => '?').join(',');
  const { results: products } = await rc.env.DB.prepare(
    `SELECT * FROM products WHERE slug IN (${placeholders}) AND is_active = 1`
  )
    .bind(...STARTER_PACK_SLUGS)
    .all<ProductRow>();
  if (products.length !== STARTER_PACK_SLUGS.length) return errorResponse('Starter Pack is temporarily unavailable');

  const origin = new URL(req.url).origin;
  const cartMeta = JSON.stringify(products.map((p) => ({ p: p.id, q: 1 })));
  const session = await stripeRequest<{ url: string }>(rc.env, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    customer_creation: 'always',
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: 'Free shipping',
          fixed_amount: { amount: 0, currency: 'usd' },
        },
      },
    ],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: STARTER_PACK_PRICE,
          product_data: {
            name: 'Starter Pack — 1 treatment from each of the 5 collections',
            description: products.map((p) => p.name).join(', '),
          },
        },
      },
    ],
    metadata: { kind: 'order', cart: cartMeta },
  });
  return json({ url: session.url });
}
