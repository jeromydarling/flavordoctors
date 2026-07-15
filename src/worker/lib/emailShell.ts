import type { Brand } from './brand';

/**
 * The one branded email shell every outbound message renders through.
 * Table-based layout with inline styles (email clients), light background,
 * brand-colored header, accent CTA, compliant footer. Returns html + a
 * readable plain-text alternative.
 */
export interface EmailShellOptions {
  heading?: string;
  /** Body content: a trusted HTML fragment (paragraphs, lists, links). */
  bodyHtml: string;
  cta?: { label: string; url: string };
  kind: 'marketing' | 'transactional';
  /** Required for marketing mail. */
  unsubUrl?: string;
  footerNote?: string;
}

export function renderBrandedEmail(brand: Brand, opts: EmailShellOptions): { html: string; text: string } {
  const c = brand.colors;
  const logo = brand.logoUrl
    ? `<img src="${escapeAttr(brand.logoUrl)}" alt="${escapeAttr(brand.name)}" height="40" style="display:block;height:40px;border:0">`
    : `<span style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:0.5px">🩺 ${escapeHtml(brand.name)}</span>`;

  const cta = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px"><tr><td style="border-radius:10px;background:${c.accent}">
<a href="${escapeAttr(opts.cta.url)}" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${c.primary};text-decoration:none;border-radius:10px">${escapeHtml(opts.cta.label)}</a>
</td></tr></table>`
    : '';

  const marketingFooter =
    opts.kind === 'marketing'
      ? `<p style="margin:12px 0 0">You're receiving this because you joined the ${escapeHtml(brand.name)} list.
<a href="${escapeAttr(opts.unsubUrl ?? '#')}" style="color:#8b97a5">Unsubscribe</a></p>`
      : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${c.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:${c.primary};border-radius:14px 14px 0 0;padding:20px 32px" align="left">${logo}</td></tr>
  <tr><td style="background:#ffffff;padding:32px;border:1px solid #e4ddcd;border-top:0">
    ${opts.heading ? `<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;line-height:1.25;color:${c.ink}">${escapeHtml(opts.heading)}</h1>` : ''}
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:${c.ink}">${opts.bodyHtml}</div>
    ${cta}
  </td></tr>
  <tr><td style="background:#faf7f0;border:1px solid #e4ddcd;border-top:0;border-radius:0 0 14px 14px;padding:20px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8b97a5" align="center">
    <p style="margin:0"><em>${escapeHtml(brand.tagline)}</em></p>
    ${opts.footerNote ? `<p style="margin:12px 0 0">${escapeHtml(opts.footerNote)}</p>` : ''}
    <p style="margin:12px 0 0">${escapeHtml(brand.postalAddress)}</p>
    ${marketingFooter}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    brand.name,
    opts.heading ?? '',
    '',
    htmlToText(opts.bodyHtml),
    opts.cta ? `\n${opts.cta.label}: ${opts.cta.url}` : '',
    '',
    '--',
    brand.tagline,
    brand.postalAddress,
    opts.kind === 'marketing' && opts.unsubUrl ? `Unsubscribe: ${opts.unsubUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
