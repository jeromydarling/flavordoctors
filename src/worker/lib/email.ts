import type { Env } from '../types';

/**
 * Send a transactional email. Uses Resend if RESEND_API_KEY is configured;
 * otherwise logs and no-ops so checkout flows never fail on email problems.
 * (Swap this for Cloudflare Email Workers / another provider as desired.)
 */
export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email skipped — no RESEND_API_KEY] to=${to} subject="${subject}"`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? 'Flavor Doctors <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) console.error(`Email send failed (${res.status}): ${await res.text()}`);
  } catch (err) {
    console.error('Email send failed:', err);
  }
}

const wrapper = (body: string) => `
<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; border: 2px solid #0D1B2A; border-radius: 8px; overflow: hidden;">
  <div style="background: #0D1B2A; color: #F5F5F5; padding: 20px 28px;">
    <span style="font-size: 26px; font-weight: bold;">℞ Flavor Doctors</span>
  </div>
  <div style="padding: 28px; background: #F5F5F5; color: #0D1B2A; font-size: 16px; line-height: 1.6;">
    ${body}
  </div>
  <div style="background: #0D1B2A; color: #F5A623; padding: 14px 28px; font-size: 13px;">
    Side effects may include eating this on everything.
  </div>
</div>`;

export function orderConfirmationEmail(items: { name: string; quantity: number }[], totalCents: number): string {
  const rows = items
    .map((i) => `<li>${i.quantity} × ${escapeHtml(i.name)}</li>`)
    .join('');
  return wrapper(`
    <h2 style="margin-top:0;">Your prescription has been filled 💊</h2>
    <p>Thanks for your order! Here's what the doctor sent:</p>
    <ul>${rows}</ul>
    <p><strong>Total: $${(totalCents / 100).toFixed(2)}</strong></p>
    <p>We'll notify you when your order ships.</p>`);
}

export function subscriptionConfirmationEmail(tierName: string, itemsPerMonth: number): string {
  return wrapper(`
    <h2 style="margin-top:0;">Welcome to the ${escapeHtml(tierName)} Monthly Rx Box 🩺</h2>
    <p>Your subscription is active — ${itemsPerMonth} doctored delights each month.</p>
    <p>Visit your account to customize your box; otherwise, we'll prescribe our best-sellers.</p>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
