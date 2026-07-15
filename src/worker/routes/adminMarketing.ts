import type { ProductRow, TierKey, CadenceKey } from '../types';
import { TIERS, CADENCES } from '../types';
import { json, errorResponse, newId, readJson, slugify } from '../lib/util';
import { requireAdmin, requireStaff } from '../lib/auth';
import { audit } from '../lib/audit';
import { runChat } from '../lib/ai';
import { base64ToBytes } from '../lib/util';
import { SEGMENTS, segmentEmails, sendMarketingEmail, upsertContact } from '../lib/marketing';
import { enqueueBroadcast, drainOutbox } from '../lib/outbox';
import { ensureCoupon, stripeRequest, type StripeError } from '../lib/stripe';

// ---------- Campaign Studio ----------

export const listCampaigns = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50').all();
  const stats = await rc.env.DB.prepare(
    `SELECT campaign_id, kind, COUNT(DISTINCT email) AS n FROM campaign_events GROUP BY campaign_id, kind`
  ).all<{ campaign_id: string; kind: string; n: number }>();
  const byCampaign: Record<string, Record<string, number>> = {};
  for (const s of stats.results) {
    byCampaign[s.campaign_id] = { ...byCampaign[s.campaign_id], [s.kind]: s.n };
  }
  return json({
    campaigns: results.map((c: Record<string, unknown>) => ({ ...c, stats: byCampaign[c.id as string] ?? {} })),
    segments: Object.entries(SEGMENTS).map(([key, s]) => ({ key, name: s.name })),
  });
});

export const createCampaign = requireAdmin(async (req, rc) => {
  const b = await readJson<{ name?: string; segment?: string; subject?: string; subjectB?: string; bodyHtml?: string }>(req);
  if (!b?.name?.trim() || !b.subject?.trim() || !b.bodyHtml?.trim()) return errorResponse('name, subject, bodyHtml required');
  if (!b.segment || !SEGMENTS[b.segment]) return errorResponse('Unknown segment');
  const id = newId('cmp');
  await rc.env.DB.prepare(
    'INSERT INTO campaigns (id, name, segment, subject, subject_b, body_html) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, b.name.trim(), b.segment, b.subject.trim(), b.subjectB?.trim() || null, b.bodyHtml)
    .run();
  return json({ id }, 201);
});

/** AI-draft campaign copy from a one-line brief. */
export const draftCampaign = requireAdmin(async (req, rc) => {
  const b = await readJson<{ brief?: string }>(req);
  if (!b?.brief?.trim()) return errorResponse('brief required');
  const { results: products } = await rc.env.DB.prepare(
    'SELECT name, description, price FROM products WHERE is_active = 1 AND is_drop = 0 LIMIT 40'
  ).all<{ name: string; description: string; price: number }>();
  const raw = await runChat(rc.env, [
    {
      role: 'user',
      content: `You are the email copywriter for Flavor Doctors (playful medical/prescription-themed premium sauce brand; voice: warm, witty, clinical wordplay — "prescribed for", "dosage", "side effects").

Catalog excerpt: ${products.slice(0, 15).map((p) => `${p.name} ($${(p.price / 100).toFixed(2)}): ${p.description}`).join(' | ')}

Write a marketing email for this brief: "${b.brief}"

Output EXACTLY this format (no markdown, no preamble):
SUBJECT: <one subject line under 60 chars>
SUBJECT_B: <a different subject line under 60 chars for A/B testing>
BODY:
<clean HTML using only h2, p, strong, a tags; 80-140 words; one clear CTA link to {{SITE_URL}}/menu or {{SITE_URL}}/subscribe>`,
    },
  ], 700);
  const subject = raw.match(/SUBJECT:\s*(.+)/)?.[1]?.trim() ?? '';
  const subjectB = raw.match(/SUBJECT_B:\s*(.+)/)?.[1]?.trim() ?? '';
  const bodyHtml = raw.split(/BODY:\s*/)[1]?.trim() ?? '';
  if (!subject || !bodyHtml) return errorResponse('AI draft came back malformed — try again', 502);
  return json({ subject, subjectB, bodyHtml });
});

export const testSendCampaign = requireAdmin(async (req, rc) => {
  const campaign = await rc.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
    .bind(rc.params.id)
    .first<{ subject: string; body_html: string }>();
  if (!campaign) return errorResponse('Campaign not found', 404);
  const origin = new URL(req.url).origin;
  await upsertContact(rc.env, rc.user!.email, { source: 'account', userId: rc.user!.id });
  const sent = await sendMarketingEmail(rc.env, origin, rc.user!.email, `[TEST] ${campaign.subject}`, campaign.body_html);
  return json({ ok: sent, to: rc.user!.email });
});

export const sendCampaign = requireAdmin(async (req, rc) => {
  const campaign = await rc.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
    .bind(rc.params.id)
    .first<{ id: string; segment: string; subject: string; subject_b: string | null; body_html: string; status: string }>();
  if (!campaign) return errorResponse('Campaign not found', 404);
  if (campaign.status === 'sent') return errorResponse('Campaign already sent', 409);

  const emails = await segmentEmails(rc.env, campaign.segment);
  if (emails.length === 0) return errorResponse('Segment has no consented contacts');

  // Queue instead of blasting inline: the paced outbox drains a few sends per
  // cron tick (warm-up-friendly), with suppression re-checked at send time.
  const recipients = emails.map((email, i) => ({
    email,
    variant: campaign.subject_b && i % 2 === 1 ? 'b' : 'a',
  }));
  const { queued, suppressed } = await enqueueBroadcast(
    rc.env, campaign.id, recipients, campaign.subject, campaign.subject_b, campaign.body_html
  );
  await rc.env.DB.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").bind(campaign.id).run();
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'campaign_send', campaign.id, `${queued} queued, ${suppressed} suppressed (${campaign.segment})`));
  return json({ ok: true, queued, suppressed, audience: emails.length });
});

/** Ops utility: drain a batch immediately instead of waiting for the cron. */
export const drainOutboxNow = requireAdmin(async (req, rc) => {
  const url = new URL(req.url);
  const batch = Math.min(parseInt(url.searchParams.get('batch') ?? '', 10) || 0, 500) || undefined;
  const result = await drainOutbox(rc.env, url.origin, batch);
  return json(result);
});

/** Outbox progress per campaign (queued/sent/failed/suppressed). */
export const outboxStatus = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    'SELECT broadcast_id, status, COUNT(*) n FROM mkt_sends GROUP BY broadcast_id, status'
  ).all<{ broadcast_id: string; status: string; n: number }>();
  const byCampaign: Record<string, Record<string, number>> = {};
  for (const r of results) (byCampaign[r.broadcast_id] ??= {})[r.status] = r.n;
  return json({ outbox: byCampaign });
});

// ---------- Flows ----------

export const listFlows = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT * FROM flows ORDER BY trigger, delay_days').all();
  return json({ flows: results });
});

export const updateFlow = requireAdmin(async (req, rc) => {
  const b = await readJson<{ enabled?: boolean; subject?: string; bodyHtml?: string; delayDays?: number }>(req);
  const existing = await rc.env.DB.prepare('SELECT * FROM flows WHERE key = ?').bind(rc.params.key).first<{
    enabled: number; subject: string; body_html: string; delay_days: number;
  }>();
  if (!existing) return errorResponse('Flow not found', 404);
  await rc.env.DB.prepare('UPDATE flows SET enabled = ?, subject = ?, body_html = ?, delay_days = ? WHERE key = ?')
    .bind(
      b?.enabled === undefined ? existing.enabled : b.enabled ? 1 : 0,
      b?.subject?.trim() || existing.subject,
      b?.bodyHtml ?? existing.body_html,
      Number.isInteger(b?.delayDays) && b!.delayDays! >= 0 ? b!.delayDays! : existing.delay_days,
      rc.params.key
    )
    .run();
  return json({ ok: true });
});

// ---------- Contacts ----------

export const contactStats = requireAdmin(async (_req, rc) => {
  const totals = await rc.env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(marketing_consent) AS consented,
            SUM(CASE WHEN source LIKE 'landing:%' OR source = 'waitlist' THEN 1 ELSE 0 END) AS waitlist,
            SUM(CASE WHEN referred_by IS NOT NULL THEN 1 ELSE 0 END) AS referred
     FROM contacts`
  ).first();
  const recent = await rc.env.DB.prepare(
    'SELECT email, source, marketing_consent, referred_by, created_at FROM contacts ORDER BY created_at DESC LIMIT 20'
  ).all();
  return json({ totals, recent: recent.results });
});

export const exportContacts = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    'SELECT email, source, marketing_consent, ref_code, referred_by, created_at FROM contacts ORDER BY created_at'
  ).all<Record<string, string | number>>();
  const header = 'email,source,marketing_consent,ref_code,referred_by,created_at';
  const rows = results.map((r) =>
    [r.email, r.source, r.marketing_consent, r.ref_code ?? '', r.referred_by ?? '', r.created_at].join(',')
  );
  return new Response([header, ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="contacts.csv"' },
  });
});

// ---------- Landing pages ----------

export const listLandingPages = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT * FROM landing_pages ORDER BY created_at DESC').all();
  return json({ pages: results });
});

export const upsertLandingPage = requireAdmin(async (req, rc) => {
  const b = await readJson<{ slug?: string; title?: string; headline?: string; body?: string; cta?: string; offer?: string; isActive?: boolean }>(req);
  if (!b?.title?.trim() || !b.headline?.trim() || !b.body?.trim()) return errorResponse('title, headline, body required');
  const slug = slugify(b.slug?.trim() || b.title);
  if (!slug) return errorResponse('Invalid slug');
  await rc.env.DB.prepare(
    `INSERT INTO landing_pages (slug, title, headline, body, cta, offer, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET title = excluded.title, headline = excluded.headline, body = excluded.body,
       cta = excluded.cta, offer = excluded.offer, is_active = excluded.is_active`
  )
    .bind(slug, b.title.trim(), b.headline.trim(), b.body.trim(), b.cta?.trim() || 'Get Early Access', b.offer?.trim() || null, b.isActive === false ? 0 : 1)
    .run();
  return json({ ok: true, slug, url: `/lp/${slug}` });
});

// ---------- Promotions ----------

export const listPromotions = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT * FROM promotions ORDER BY starts_at DESC').all();
  return json({ promotions: results });
});

export const createPromotion = requireAdmin(async (req, rc) => {
  const b = await readJson<{ name?: string; code?: string; percentOff?: number; bannerText?: string; startsAt?: string; endsAt?: string }>(req);
  if (!b?.name?.trim()) return errorResponse('name required');
  const code = (b.code ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (code.length < 3 || code.length > 20) return errorResponse('code must be 3-20 alphanumeric characters');
  if (!Number.isInteger(b.percentOff) || b.percentOff! < 1 || b.percentOff! > 90) return errorResponse('percentOff must be 1-90');
  const startsAt = b.startsAt && !Number.isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt).toISOString() : new Date().toISOString();
  if (!b.endsAt || Number.isNaN(Date.parse(b.endsAt))) return errorResponse('endsAt required');
  const endsAt = new Date(b.endsAt).toISOString();

  await ensureCoupon(rc.env, `PROMO_${code}`, b.percentOff!, b.name.trim());
  try {
    await stripeRequest(rc.env, 'POST', '/v1/promotion_codes', { coupon: `PROMO_${code}`, code });
  } catch (err) {
    if ((err as StripeError).stripeCode !== 'resource_already_exists') {
      // Promotion codes can't be duplicated; surface everything else.
      const msg = (err as Error).message;
      if (!/already exists|already been used/i.test(msg)) throw err;
    }
  }
  const id = newId('promo');
  await rc.env.DB.prepare(
    'INSERT INTO promotions (id, name, code, percent_off, banner_text, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, b.name.trim(), code, b.percentOff, b.bannerText?.trim() || null, startsAt, endsAt)
    .run();
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'promo_create', code, `${b.percentOff}% off until ${endsAt}`));
  return json({ id, code }, 201);
});

export const deactivatePromotion = requireAdmin(async (_req, rc) => {
  const result = await rc.env.DB.prepare('UPDATE promotions SET is_active = 0 WHERE id = ?').bind(rc.params.id).run();
  if (result.meta.changes === 0) return errorResponse('Promotion not found', 404);
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'promo_deactivate', rc.params.id));
  return json({ ok: true });
});

// ---------- Analytics + Distributor Readiness ----------

export const analytics = requireStaff(async (_req, rc) => {
  const db = rc.env.DB;
  const [subs, orders30, ordersAll, repeat, topProducts, contacts, ratings, reviews, nps, saveOffers] = await Promise.all([
    db.prepare("SELECT tier, cadence, COUNT(*) AS n FROM subscriptions WHERE status IN ('active','past_due','paused') GROUP BY tier, cadence").all<{ tier: string; cadence: string; n: number }>(),
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue FROM orders WHERE status != 'canceled' AND created_at > datetime('now','-30 days')").first<{ n: number; revenue: number }>(),
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue FROM orders WHERE status != 'canceled'").first<{ n: number; revenue: number }>(),
    db.prepare(`SELECT COUNT(*) AS buyers, SUM(CASE WHEN c > 1 THEN 1 ELSE 0 END) AS repeaters FROM (SELECT email, COUNT(*) AS c FROM orders WHERE email IS NOT NULL AND status != 'canceled' GROUP BY email)`).first<{ buyers: number; repeaters: number }>(),
    db.prepare(`SELECT p.name, SUM(oi.quantity) AS units FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.id ORDER BY units DESC LIMIT 8`).all<{ name: string; units: number }>(),
    db.prepare('SELECT COUNT(*) AS total, SUM(marketing_consent) AS consented FROM contacts').first<{ total: number; consented: number }>(),
    db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM product_ratings').first<{ n: number; avg: number | null }>(),
    db.prepare('SELECT COUNT(*) AS approved FROM product_reviews WHERE approved = 1').first<{ approved: number }>(),
    db.prepare(
      'SELECT COUNT(*) AS n, SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) AS promoters, SUM(CASE WHEN score <= 6 THEN 1 ELSE 0 END) AS detractors FROM nps_responses'
    ).first<{ n: number; promoters: number | null; detractors: number | null }>(),
    db.prepare(
      "SELECT SUM(CASE WHEN action = 'cancel' THEN 1 ELSE 0 END) AS cancels, SUM(CASE WHEN action IN ('discount','pause','skip','undo_cancel') THEN 1 ELSE 0 END) AS saves FROM save_offer_events"
    ).first<{ cancels: number | null; saves: number | null }>(),
  ]);

  let mrr = 0;
  let activeSubscribers = 0;
  for (const row of subs.results) {
    const tier = TIERS[row.tier as TierKey];
    const cadence = CADENCES[(row.cadence ?? 'monthly') as CadenceKey] ?? CADENCES.monthly;
    if (!tier) continue;
    activeSubscribers += row.n;
    // Monthly-equivalent revenue: bimonthly halves, annual = 10x/12.
    const monthly = row.cadence === 'annual' ? (tier.price * 10) / 12 : tier.price / cadence.intervalCount;
    mrr += monthly * row.n;
  }

  const buyers = repeat?.buyers ?? 0;
  const repeatRate = buyers > 0 ? (repeat?.repeaters ?? 0) / buyers : 0;
  const avgRating = ratings?.avg ?? 0;
  const reviewCount = (ratings?.n ?? 0) + (reviews?.approved ?? 0);

  // The distributor-readiness benchmarks from the launch plan.
  const scorecard = [
    { metric: 'Repeat purchase rate (90d)', target: '>40%', value: `${Math.round(repeatRate * 100)}%`, met: repeatRate > 0.4 },
    { metric: 'Monthly subscription revenue', target: '$5,000+', value: `$${(mrr / 100).toFixed(0)}`, met: mrr >= 500000 },
    { metric: 'Active subscribers', target: '150+', value: `${activeSubscribers}`, met: activeSubscribers >= 150 },
    { metric: 'Reviews at 4.5+ stars', target: '50+ reviews, 4.5+ avg', value: `${reviewCount} @ ${avgRating.toFixed(1)}`, met: reviewCount >= 50 && avgRating >= 4.5 },
    { metric: 'Consented email list', target: '500+', value: `${contacts?.consented ?? 0}`, met: (contacts?.consented ?? 0) >= 500 },
  ];

  return json({
    mrr,
    activeSubscribers,
    orders30d: orders30?.n ?? 0,
    revenue30d: orders30?.revenue ?? 0,
    ordersTotal: ordersAll?.n ?? 0,
    revenueTotal: ordersAll?.revenue ?? 0,
    aov: (ordersAll?.n ?? 0) > 0 ? Math.round((ordersAll!.revenue as number) / ordersAll!.n) : 0,
    repeatRate: Math.round(repeatRate * 100),
    topProducts: topProducts.results,
    contacts: contacts,
    nps: {
      responses: nps?.n ?? 0,
      score:
        (nps?.n ?? 0) > 0 ? Math.round((((nps!.promoters ?? 0) - (nps!.detractors ?? 0)) / nps!.n) * 100) : null,
      promoters: nps?.promoters ?? 0,
      detractors: nps?.detractors ?? 0,
    },
    saveOffers: { cancels: saveOffers?.cancels ?? 0, saves: saveOffers?.saves ?? 0 },
    scorecard,
  });
});

// ---------- AI Content Studio ----------

const CONTENT_PROMPTS: Record<string, (ctx: string, brief: string) => string> = {
  'social-calendar': (ctx, brief) =>
    `Create a one-week social content calendar for Flavor Doctors (medical-themed premium sauce brand). Pillars: (1) "The Diagnosis" 15-30s recipe videos, (2) behind-the-scenes, (3) educational (why ghee, how hollandaise mayo works), (4) blind taste-test reactions. Schedule: TikTok 5 posts, Instagram Reels 3 + 1 Story, Pinterest 3 pins.\n\nCatalog: ${ctx}\n\nExtra direction: ${brief || 'none'}\n\nFor each post output: DAY, PLATFORM, PILLAR, HOOK (first line spoken/shown), CONCEPT (2 sentences), CAPTION (with 3-5 hashtags). Plain text, no markdown tables.`,
  captions: (ctx, brief) =>
    `Write 6 TikTok caption variants for Flavor Doctors products. Voice: playful clinical wordplay ("prescribed for", "dosage", "side effects"). Each under 150 chars + 3 hashtags.\n\nProduct focus: ${brief || 'best-sellers'}\n\nCatalog: ${ctx}\n\nOutput numbered 1-6, plain text.`,
  'subject-lines': (ctx, brief) =>
    `Write 8 email subject lines for Flavor Doctors (medical-themed sauce brand). Mix: 2 curiosity, 2 urgency, 2 benefit-led, 2 pun-forward. Each under 55 chars.\n\nCampaign context: ${brief || 'general promotion'}\n\nCatalog: ${ctx}\n\nOutput numbered 1-8, plain text.`,
};

export const generateContent = requireAdmin(async (req, rc) => {
  const b = await readJson<{ type?: string; brief?: string }>(req);
  const type = b?.type ?? '';
  if (!CONTENT_PROMPTS[type]) return errorResponse(`type must be one of: ${Object.keys(CONTENT_PROMPTS).join(', ')}`);
  const { results: products } = await rc.env.DB.prepare(
    'SELECT name, description FROM products WHERE is_active = 1 AND is_drop = 0 ORDER BY is_bestseller DESC LIMIT 12'
  ).all<{ name: string; description: string }>();
  const ctx = products.map((p) => `${p.name}: ${p.description}`).join(' | ');
  try {
    const output = await runChat(rc.env, [{ role: 'user', content: CONTENT_PROMPTS[type](ctx, b?.brief ?? '') }], 1200);
    return json({ output });
  } catch (err) {
    console.error('Content generation failed:', err);
    return errorResponse('The content lab is busy — try again shortly', 503);
  }
});

export const generateLifestyleImage = requireAdmin(async (req, rc) => {
  const b = await readJson<{ productId?: string; scene?: string }>(req);
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(b?.productId ?? '').first<ProductRow>();
  if (!product) return errorResponse('Product not found', 404);
  const scene = (b?.scene ?? 'on a rustic dinner table beside the finished dish').slice(0, 200);
  const prompt = `Lifestyle food photography: ${product.name} by Flavor Doctors (${product.description}) ${scene}. Warm natural light, shallow depth of field, premium editorial food-magazine style, medical-prescription-themed navy and gold label visible. Photorealistic.`;
  try {
    const result = (await rc.env.AI.run('@cf/black-forest-labs/flux-1-schnell' as Parameters<Ai['run']>[0], {
      prompt,
      steps: 8,
    })) as { image?: string };
    if (!result.image) throw new Error('no image');
    const bytes = base64ToBytes(result.image);
    const key = `marketing/${product.slug}/${Date.now()}.png`;
    const isPng = bytes.length > 4 && bytes[0] === 0x89;
    await rc.env.PRODUCT_IMAGES.put(key, bytes as unknown as ArrayBuffer, {
      httpMetadata: { contentType: isPng ? 'image/png' : 'image/jpeg' },
    });
    return json({ imageUrl: `/images/${key}` });
  } catch (err) {
    console.error('Lifestyle image generation failed:', err);
    return errorResponse('Image lab is busy — try again shortly', 503);
  }
});

// ---------- B2B kit ----------

const WHOLESALE_FACTOR = 0.5; // standard keystone: wholesale = 50% of MSRP

export const sellSheet = requireAdmin(async (req, rc) => {
  const url = new URL(req.url);
  const collection = url.searchParams.get('collection');
  const where = collection ? 'AND collection = ?' : '';
  const stmt = rc.env.DB.prepare(`SELECT * FROM products WHERE is_active = 1 AND is_drop = 0 ${where} ORDER BY collection, name`);
  const { results } = await (collection ? stmt.bind(collection) : stmt).all<ProductRow>();
  const origin = url.origin;
  const rows = results
    .map(
      (p) => `<tr>
<td>${p.image_r2_key ? `<img src="${origin}/images/${p.image_r2_key}" width="52" height="52" style="border-radius:6px;object-fit:cover">` : ''}</td>
<td><strong>${p.name}</strong><br><span style="color:#555">${p.description}</span></td>
<td>${p.collection}</td>
<td>$${(p.price / 100).toFixed(2)}</td>
<td>$${((p.price * WHOLESALE_FACTOR) / 100).toFixed(2)}</td>
<td>50%</td></tr>`
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Flavor Doctors — Sell Sheet</title>
<style>body{font-family:Georgia,serif;color:#0D1B2A;margin:32px}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
td,th{border-bottom:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#0D1B2A;color:#fff}
.head{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #2ECC71;padding-bottom:12px}
@media print{button{display:none}}</style></head><body>
<div class="head"><div><h1>℞ Flavor Doctors</h1><p>Small-batch doctored condiments — every product shelf-stable, every label a prescription.</p></div>
<div style="text-align:right"><strong>Wholesale inquiries</strong><br>orders@flavordoctors.com<br>flavordoctors.com</div></div>
<p><strong>Line:</strong> ${collection ?? 'Full catalog'} · <strong>MOQ:</strong> 12 units/SKU · <strong>Lead time:</strong> 2-3 weeks · <strong>Terms:</strong> Net 30</p>
<button onclick="print()" style="padding:8px 16px;font-weight:bold">🖨 Print / Save PDF</button>
<table><tr><th></th><th>Product</th><th>Line</th><th>MSRP</th><th>Wholesale</th><th>Margin</th></tr>${rows}</table>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

export const rangeMeCsv = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND is_drop = 0 ORDER BY collection, name'
  ).all<ProductRow>();
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = 'Product Name,Category,Description,MSRP,Wholesale Price,Margin %,Container,Shelf Stable,Brand';
  const container: Record<string, string> = {
    mayo: '8 oz glass jar', 'burger-sauce': '8 oz glass jar', toppers: '8 oz glass jar',
    butter: '4 oz glass jar (ghee)', seasoning: '4 oz shaker',
  };
  const rows = results.map((p) =>
    [
      esc(p.name), esc(p.collection), esc(p.ai_description ?? p.description),
      (p.price / 100).toFixed(2), ((p.price * WHOLESALE_FACTOR) / 100).toFixed(2), '50',
      esc(container[p.collection] ?? 'glass jar'), 'Yes', 'Flavor Doctors',
    ].join(',')
  );
  return new Response([header, ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="flavordoctors-rangeme.csv"' },
  });
});

// ---------- Review moderation ----------

export const pendingReviews = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    `SELECT r.id, r.rating, r.body, r.created_at, p.name AS product_name, u.email
     FROM product_reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id
     WHERE r.approved = 0 ORDER BY r.created_at DESC LIMIT 50`
  ).all();
  return json({ reviews: results });
});

export const moderateReview = requireAdmin(async (req, rc) => {
  const b = await readJson<{ action?: string }>(req);
  if (b?.action === 'approve') {
    await rc.env.DB.prepare('UPDATE product_reviews SET approved = 1 WHERE id = ?').bind(rc.params.id).run();
  } else if (b?.action === 'delete') {
    await rc.env.DB.prepare('DELETE FROM product_reviews WHERE id = ?').bind(rc.params.id).run();
  } else {
    return errorResponse('action must be approve or delete');
  }
  return json({ ok: true });
});
