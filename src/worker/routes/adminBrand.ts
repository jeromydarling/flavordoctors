import type { RequestContext } from '../types';
import { json, readJson, errorResponse } from '../lib/util';
import { requireAdmin } from '../lib/auth';
import { getBrand, saveBrand, type Brand } from '../lib/brand';
import { renderBrandedEmail } from '../lib/emailShell';
import { audit } from '../lib/audit';

export const getBrandSettings = requireAdmin(async (_req, rc) => {
  return json({ brand: await getBrand(rc.env) });
});

export const updateBrandSettings = requireAdmin(async (req, rc) => {
  const body = await readJson<Partial<Brand>>(req);
  if (!body) return errorResponse('Invalid JSON body');
  if (body.colors) {
    for (const v of Object.values(body.colors)) {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return errorResponse('Colors must be #RRGGBB hex values');
    }
  }
  if (body.name !== undefined && !String(body.name).trim()) return errorResponse('Brand name cannot be empty');
  await saveBrand(rc.env, body);
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'brand_update', 'brand', Object.keys(body).join(',')));
  return json({ brand: await getBrand(rc.env) });
});

/** Live preview: the branded shell rendered with sample content. */
export const previewBrandEmail = requireAdmin(async (req, rc) => {
  const kind = new URL(req.url).searchParams.get('kind') === 'transactional' ? 'transactional' : 'marketing';
  const brand = await getBrand(rc.env);
  if (rc.env.BUSINESS_ADDRESS) brand.postalAddress = rc.env.BUSINESS_ADDRESS;
  const { html } = renderBrandedEmail(brand, {
    heading: kind === 'marketing' ? 'The Spring Flavor Clinic is open' : 'Your prescription has shipped',
    bodyHtml:
      kind === 'marketing'
        ? `<p>Hi {{name}},</p><p>Three new treatments just hit the pharmacy shelves, and your chronic weeknight blandness doesn't stand a chance. This month's featured prescription: <strong>Chile-Lime Cure</strong> on roasted corn.</p><p>As always — take with food.</p>`
        : `<p>Good news: order <strong>#FD-1042</strong> left the clinic today and is en route to your kitchen.</p><p>Track it any time from your account.</p>`,
    cta:
      kind === 'marketing'
        ? { label: 'Browse the new treatments', url: 'https://flavordoctors.com/menu' }
        : { label: 'View your order', url: 'https://flavordoctors.com/account' },
    kind,
    unsubUrl: 'https://flavordoctors.com/unsubscribe?token=preview',
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
