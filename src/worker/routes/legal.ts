import type { RequestContext } from '../types';

/**
 * Server-rendered legal pages (privacy, terms, shipping & returns).
 * Rendered at the edge like the treatment-plans hub so they're indexable,
 * load with zero JS, and stay out of the SPA bundle.
 */

const EFFECTIVE_DATE = 'July 15, 2026';
const CONTACT = 'orders@flavordoctors.com';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function legalShell(title: string, description: string, canonical: string, inner: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — Flavor Doctors</title>
<meta name="description" content="${esc(description)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:url" content="${canonical}">
<style>
body{font-family:Georgia,serif;background:#0D1B2A;color:#F5F5F5;margin:0;line-height:1.7}
.wrap{max-width:720px;margin:0 auto;padding:48px 20px}
a{color:#2ECC71}
h1{font-size:36px;line-height:1.15;margin:8px 0 4px}
h2{color:#F5A623;margin-top:36px;font-size:22px}
.kicker{color:#F5A623;text-transform:uppercase;letter-spacing:3px;font-size:13px;font-weight:bold}
.date{color:#7d8b9a;font-size:14px;margin-bottom:24px}
ul{padding-left:24px}
li{margin:6px 0}
footer{margin-top:48px;color:#7d8b9a;font-size:14px}
</style></head><body><div class="wrap">
<a href="/" style="text-decoration:none">🩺 <strong style="color:#F5F5F5">Flavor Doctors</strong></a>
${inner}
<footer>Flavor Doctors · New Prague, MN, USA · <a href="mailto:${CONTACT}">${CONTACT}</a><br>
<a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/shipping-returns">Shipping &amp; Returns</a> · <a href="/menu">Menu</a></footer>
</div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function privacyPolicy(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  return legalShell(
    'Privacy Policy',
    'How Flavor Doctors collects, uses, and protects your information.',
    `${origin}/privacy`,
    `<p class="kicker">The fine print</p>
<h1>Privacy Policy</h1>
<p class="date">Effective ${EFFECTIVE_DATE}</p>

<h2>What we collect</h2>
<ul>
<li><strong>Account details</strong> — your email address and a securely hashed password when you register.</li>
<li><strong>Order information</strong> — what you bought, your shipping address, and order history. Payments are processed by <a href="https://stripe.com/privacy" rel="noopener">Stripe</a>; your card number never touches our servers.</li>
<li><strong>Preferences you give us</strong> — flavor-profile answers from the Intake Exam, saved favorites, and marketing consent choices.</li>
<li><strong>Usage analytics</strong> — we use Google Analytics (GA4) to understand how the site is used. GA4 sets cookies; see Google's privacy documentation for details.</li>
<li><strong>Support &amp; affiliate data</strong> — messages you send our support team, and application details if you apply to our affiliate program.</li>
</ul>

<h2>How we use it</h2>
<ul>
<li>To fulfill orders, manage subscriptions, and provide customer support.</li>
<li>To send transactional email (order confirmations, password resets, restock alerts you asked for).</li>
<li>To send marketing email <strong>only if you opted in</strong> — every message includes one-click unsubscribe.</li>
<li>To run the referral, points, and affiliate programs you participate in.</li>
<li>To improve the site through aggregate analytics.</li>
</ul>

<h2>What we don't do</h2>
<ul>
<li>We do not sell your personal information. Ever.</li>
<li>We do not share your data with third parties except the service providers who run the store: Stripe (payments), Cloudflare (hosting and infrastructure), Google (analytics), and our email delivery providers.</li>
</ul>

<h2>Your rights</h2>
<ul>
<li><strong>Access &amp; portability</strong> — email us and we'll send you the data we hold about you.</li>
<li><strong>Deletion</strong> — you can delete your account (and its data) yourself from Account → Settings, or ask us to do it.</li>
<li><strong>Correction</strong> — update your details in your account, or ask us.</li>
<li>California residents: we honor CCPA requests. EU/UK visitors: we honor GDPR requests. Contact us at <a href="mailto:${CONTACT}">${CONTACT}</a>.</li>
</ul>

<h2>Data retention &amp; security</h2>
<p>Order records are kept as long as required for tax and accounting. Passwords are stored hashed, authentication uses signed tokens, and all traffic is encrypted in transit. Our infrastructure runs on Cloudflare's network in the United States.</p>

<h2>Children</h2>
<p>The site isn't directed at children under 13 and we don't knowingly collect their data.</p>

<h2>Changes &amp; contact</h2>
<p>We'll update this page if our practices change. Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`
  );
}

export async function termsOfService(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  return legalShell(
    'Terms of Service',
    'The terms that govern your use of flavordoctors.com and purchases from Flavor Doctors.',
    `${origin}/terms`,
    `<p class="kicker">The fine print</p>
<h1>Terms of Service</h1>
<p class="date">Effective ${EFFECTIVE_DATE}</p>

<h2>The satire disclaimer (the important one)</h2>
<p>Flavor Doctors is a food company with a sense of humor. Our "prescriptions," "diagnoses," "treatments," and "clinical trials" are jokes about sauces and seasonings — <strong>none of it is medical advice</strong>, none of our staff are your physician, and our products are foods, not drugs. Statements on this site have not been evaluated by the Food and Drug Administration. Our products are not intended to diagnose, treat, cure, or prevent any disease — except, figuratively, blandness.</p>

<h2>Your account</h2>
<p>Keep your password safe; you're responsible for activity on your account. You must be 18+ (or the age of majority where you live) to purchase. We may suspend accounts that abuse the site, other customers, our staff, or our promotional programs.</p>

<h2>Orders &amp; pricing</h2>
<p>Prices are in USD and may change. We may cancel and refund any order (e.g., pricing errors, suspected fraud, or stock issues). Promotional discounts and bundle pricing apply as described at checkout and can't be exchanged for cash.</p>

<h2>Subscriptions (the Rx Box)</h2>
<p>Subscriptions renew automatically at the interval you chose until you cancel. You can cancel anytime from your account — cancellation stops future renewals; it doesn't refund boxes already charged. We may offer you a discount to stay; accepting one applies it to your next renewal.</p>

<h2>Points, referrals &amp; promotions</h2>
<p>Loyalty points and referral credits have no cash value, can't be transferred or sold, and may be adjusted or expired if obtained through abuse (self-referrals, fake accounts, chargeback gaming). We can modify or end promotional programs prospectively at any time.</p>

<h2>Affiliate program</h2>
<p>The House Call Network is governed by the additional terms presented when you apply, including FTC disclosure requirements for any content you post. Commissions on refunded or charged-back orders are reversed.</p>

<h2>Product information &amp; allergens</h2>
<p>Read the label on every jar before consuming — that label is authoritative for ingredients and allergens. If you have a food allergy, check the product page and the physical label, and contact us with any doubt before eating.</p>

<h2>Intellectual property</h2>
<p>The site, brand, characters, copy, and imagery are ours. Don't reuse them commercially without written permission — affiliates receive a limited license to use assets from their Medical Library kit.</p>

<h2>Liability</h2>
<p>To the maximum extent permitted by law, our liability for any claim relating to the site or an order is limited to the amount you paid for that order. Nothing in these terms limits liability that can't legally be limited.</p>

<h2>Governing law &amp; disputes</h2>
<p>These terms are governed by the laws of the State of Minnesota, USA. Disputes will be resolved in the state or federal courts located in Minnesota, and you consent to their jurisdiction.</p>

<h2>Changes &amp; contact</h2>
<p>We may update these terms; continued use after changes means acceptance. Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`
  );
}

export async function shippingReturns(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  return legalShell(
    'Shipping & Returns',
    'Shipping times, costs, and our refund policy for Flavor Doctors orders.',
    `${origin}/shipping-returns`,
    `<p class="kicker">Logistics, stat</p>
<h1>Shipping &amp; Returns</h1>
<p class="date">Effective ${EFFECTIVE_DATE}</p>

<h2>Shipping</h2>
<ul>
<li>We currently ship to <strong>US addresses only</strong>.</li>
<li><strong>Free shipping on orders over $45.</strong> Below that, the rate is shown at checkout before you pay.</li>
<li>Orders ship from Minnesota within 2 business days and typically arrive within 2–5 business days of shipping.</li>
<li>You'll get a confirmation email when your order ships. Rx Box subscriptions ship on your renewal cycle.</li>
</ul>

<h2>Damaged, wrong, or missing items</h2>
<p>If anything arrives broken, leaking, incorrect, or not at all, email <a href="mailto:${CONTACT}">${CONTACT}</a> within 30 days of delivery (a photo helps for damage). We'll replace it or refund it — your choice. That's a diagnosis we treat immediately.</p>

<h2>Returns &amp; refunds</h2>
<ul>
<li>Because our products are food, we can't accept returns of opened jars, and unopened food can't be restocked once shipped — so <strong>we generally don't do physical returns</strong>.</li>
<li>Instead: <strong>first-jar guarantee</strong>. If your first order of any product isn't for you, tell us within 30 days and we'll refund that item — no need to ship anything back.</li>
<li>Refunds go to your original payment method and appear within 5–10 business days of being issued.</li>
</ul>

<h2>Cancellations</h2>
<p>Need to change or cancel an order? Email us immediately — if it hasn't shipped yet, we'll fix it. Subscription cancellations take effect on the next renewal and can be done from your account anytime.</p>

<h2>Questions</h2>
<p>The clinic is always open: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`
  );
}
