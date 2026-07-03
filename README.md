# 🩺 Flavor Doctors

**Live at [flavordoctors.com](https://flavordoctors.com)** — deployed automatically by Cloudflare Workers Builds on every push to this repo.

Subscription-based e-commerce for a small-batch sauce & seasoning brand, built entirely on Cloudflare:

- **Frontend:** React + TypeScript + Tailwind CSS (Vite), served as Workers static assets (SPA)
- **API:** Cloudflare Workers (TypeScript) — same Worker serves the SPA and `/api/*`
- **Database:** Cloudflare D1 (`DB` binding) — products, users, orders, subscriptions
- **Storage:** Cloudflare R2 (`PRODUCT_IMAGES` binding) — Flux-generated product photography, served via `/images/*`
- **AI:** Cloudflare Workers AI (`AI` binding)
  - `@cf/meta/llama-3.1-8b-instruct` — prescription-style product descriptions
  - `@cf/black-forest-labs/flux-1-schnell` — consistent product photography per SKU
- **Payments:** Stripe Checkout (one-time) + Stripe Subscriptions (Monthly Rx Box) + Customer Portal
- **Auth:** JWT (HS256, HttpOnly cookie) signed in the Worker; PBKDF2 password hashing via WebCrypto
- **Email:** Cloudflare Email Service (`EMAIL` send_email binding, Workers Paid — 3,000/mo included, then $0.35/1k), with optional Resend fallback; graceful no-op if neither is configured

## Project layout

```
├── index.html, src/frontend/     # React SPA (pages, components, contexts)
├── src/worker/                   # Workers API (router, routes, lib)
├── migrations/0001_init.sql      # D1 schema
├── seed.sql                      # 34-product catalog seed
├── wrangler.toml                 # Bindings: DB, PRODUCT_IMAGES, AI, ASSETS
└── dist/client/                  # Vite build output (created by `npm run build`)
```

## Pages

| Route | Description |
| --- | --- |
| `/` | Homepage: hero, departments, best-sellers, Rx Box CTA |
| `/menu` | Full catalog with collection filtering |
| `/product/:slug` | Detail page with AI "Doctor's Notes" (generated & cached on first view) |
| `/subscribe` | Monthly Rx Box tiers — Starter Rx $39 (4 items), Standard Rx $54 (6), Full Prescription $69 (8) |
| `/about`, `/faq` | Brand story + "Patient Information Leaflet" |
| `/login` | Sign in / register |
| `/account` | Order history, subscription status, Stripe billing portal |
| `/account/customize` | Pick exactly N products for the monthly box (default = best-sellers) |
| `/intake-exam` | The Intake Exam — flavor-diagnosis quiz → AI diagnosis + prescribed products (saved to My Chart when signed in) |
| `/trials` | Clinical Trials — limited flavor drops with waitlist; Rx Box subscribers get 48h early access |
| `/admin/products` | Product CRUD + AI description generation + Clinical Trial drop scheduling (admin) |
| `/admin/orders` | Order management (admin) |
| `/admin/image-gen` | Flux image generation per SKU → publishes to R2 `products/{slug}/hero.png` (admin) |

## Marketing OS (admin)

- **Campaign Studio** (/admin/marketing) — segment builder over D1 (waitlist, customers, active/canceled subscribers, lapsed 30d…), AI-drafted copy, A/B subject lines, test-send, batched sending via Email Service with open/click tracking. CAN-SPAM compliant: consent-checked, one-click unsubscribe, List-Unsubscribe headers, physical address (BUSINESS_ADDRESS var).
- **Lifecycle Flows** — editable automations on the nightly cron: 4-email pre-launch waitlist drip + day-3 review request (plus the hardcoded refill/win-back/drop notifications). Deduped per contact.
- **Landing Pages + Referrals** (/admin/promos) — server-rendered /lp/{slug} pages with email capture, UTM tracking, and a referral loop (3 referrals → auto-issued 15% Stripe promo code).
- **Specials & Sales** — scheduled promotions create real Stripe promo codes and show a sitewide countdown banner; checkout accepts promo codes (bundles keep the automatic 15%). Starter Pack sampler: 5 hero SKUs, $49, free shipping.
- **Analytics + Distributor Readiness** (/admin/analytics) — MRR, subscribers, AOV, repeat rate, top SKUs, and a live scorecard against the KeHE/UNFI pitch benchmarks. GA4 optional: set GA4_MEASUREMENT_ID (gtag injected at edge) + GA4_API_SECRET (server-side purchase events via Measurement Protocol).
- **AI Content Studio** (/admin/content) — weekly social calendars, TikTok captions, subject-line batteries (llama), and Flux lifestyle imagery saved to R2.
- **B2B Kit** — print-ready sell sheets (per line or full catalog, keystone margins) and RangeMe CSV export.
- **Written reviews** — customers add reviews from My Chart, admin moderates, approved reviews show on product pages and feed AggregateRating stars into search results.
- **SMS** — Twilio-backed channel stub (set TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM secrets; A2P 10DLC registration required before production use).

## Growth & retention features

- **Skip / Pause / Resume** — one-click from My Chart (`pause_collection` on Stripe); paused status synced via webhook.
- **Cadence** — monthly or every-2-months at every tier (inline `interval_count`), chosen at signup.
- **Pricing plays** — first Rx Box 20% off (auto-coupon, new subscribers only), any 3+ items 15% off automatically, free shipping ≥ $45 ($6.95 flat below); coupons are created lazily and idempotently via the Stripe API.
- **Board Certification loyalty** — 1 point per $1 (awarded idempotently from webhooks); tiers: Patient → Resident → Attending → Chief of Medicine, shown in My Chart.
- **Flavor Health Record** — 1-click star ratings on past order items.
- **The Pharmacist** — floating AI consult chat grounded in the live catalog (Workers AI), with add-to-cart suggestions.
- **Clinical Trials** — admin-scheduled limited drops with stock caps, guest waitlists, subscriber early-access checkout gating, and stock decremented on paid webhooks.
- **Nightly cron** (16:00 UTC) — refill reminders (orders 30-45 days old), win-back emails for canceled subscribers, drop-open waitlist notifications; all deduped via `sent_emails` and no-ops without `RESEND_API_KEY`.

Admin access is granted automatically to emails listed in the `ADMIN_EMAILS` var in `wrangler.toml`.

## Setup

### 1. Install & configure

```bash
npm install
```

`wrangler.toml` already points at the provisioned resources:

- D1 database `flavordoctors-db` (`bed2572c-6958-4c16-97a0-f3d500b52fd3`)
- R2 bucket `flavordoctors-product-images`

To use your own account, create fresh resources and update the ids:

```bash
wrangler d1 create flavordoctors-db          # copy database_id into wrangler.toml
wrangler r2 bucket create flavordoctors-product-images
```

### 2. Secrets & environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | secret | Stripe API key (`sk_...`) |
| `STRIPE_WEBHOOK_SECRET` | secret | Webhook signing secret (`whsec_...`) |
| `JWT_SECRET` | secret | Random string for signing auth tokens |
| `RESEND_API_KEY` | secret (optional) | Fallback email provider if the Email Service binding is absent/fails |
| `ADMIN_EMAILS` | var (`wrangler.toml`) | Comma-separated admin email allowlist |
| `EMAIL_FROM` | var (`wrangler.toml`) | From address — must be on your Email Service sending domain |

**Email Service setup (one-time, dashboard):** transactional email sends through
Cloudflare Email Service via the `EMAIL` binding in `wrangler.toml`. To activate it:

1. Add a domain to your Cloudflare account (if you don't have one attached yet).
2. Dashboard → **Compute → Email Service → Email Sending → Onboard Domain** —
   Cloudflare auto-creates the SPF/DKIM/DMARC/bounce DNS records (`cf-bounce` subdomain).
3. Set `EMAIL_FROM` in `wrangler.toml` to an address on that domain (e.g.
   `Flavor Doctors <orders@yourdomain.com>`) and redeploy.

Until a sending domain is onboarded, Email Service only delivers to your account's
verified destination addresses (those sends are free and don't count against quota) —
useful for testing. In `wrangler dev`, sends are simulated and logged locally; set
`remote = true` on the binding to send real email during development.

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put JWT_SECRET        # e.g. openssl rand -hex 32
wrangler secret put RESEND_API_KEY    # optional
```

For local dev, put the same names in a `.dev.vars` file (gitignored).

### 3. Database migrations & seed

```bash
npm run db:migrate      # apply migrations to remote D1
npm run db:seed         # load the 34-product catalog
# local equivalents: npm run db:migrate:local && npm run db:seed:local
```

(The remote database that ships in `wrangler.toml` has already been migrated and seeded.)

### 4. Stripe webhook

Create a webhook endpoint in the Stripe dashboard pointing at:

```
https://flavordoctors.com/api/webhooks/stripe
```

with events: `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

No Stripe products/prices need pre-creating — checkout sessions use inline
`price_data` for both one-time carts and monthly subscriptions.

### 5. Develop

```bash
npm run dev            # build SPA + wrangler dev (full stack on :8787)
npm run dev:frontend   # Vite HMR on :5173, proxying /api + /images to :8787
```

Note: the Workers AI binding proxies to Cloudflare even in local dev, so `wrangler dev`
needs an authenticated session (`wrangler login` or `CLOUDFLARE_API_TOKEN`).

### 6. Deploy

**Via Cloudflare Workers Builds (already active):** this repo is connected to
Workers Builds, so every push builds and deploys the Worker automatically —
no credentials or manual steps needed for code changes.

Workers Builds does **not** manage Worker secrets or run D1 migrations. Set the
secrets once, either in the Cloudflare dashboard (Workers & Pages →
`flavordoctors` → Settings → Variables and Secrets): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, and optionally `RESEND_API_KEY` — or via
the GitHub Actions deploy workflow below. Until `JWT_SECRET` is set,
registration/login will error; until the Stripe secrets are set, checkout and
webhooks will error (catalog browsing works regardless). Future migrations can
be applied with `npm run db:migrate` or the Actions workflow.

**Via GitHub Actions (alternative — also syncs secrets and runs migrations):**

Deployment is automated in `.github/workflows/deploy.yml`. Every push to `main`
typechecks, builds, applies D1 migrations, deploys the Worker, and syncs Worker
secrets from GitHub repo secrets. Set these under
**Settings → Secrets and variables → Actions**:

| GitHub secret | Required | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | ✅ | API token with Workers Scripts:Edit + D1:Edit (start from the "Edit Cloudflare Workers" template and add D1) |
| `CLOUDFLARE_ACCOUNT_ID` | if the token spans multiple accounts | Cloudflare dashboard → Workers & Pages → right sidebar |
| `STRIPE_SECRET_KEY` | ✅ | synced to the Worker on each deploy |
| `STRIPE_WEBHOOK_SECRET` | ✅ | synced to the Worker on each deploy |
| `JWT_SECRET` | optional | auto-generated on first deploy if omitted |
| `RESEND_API_KEY` | optional | enables confirmation emails |

The deploy workflow can also be run manually (**Actions → Deploy → Run workflow**),
with an opt-in checkbox to re-run the catalog seed (off by default — re-seeding
resets `ai_description`/`image_r2_key` on the 34 seed SKUs).

`.github/workflows/ci.yml` runs typecheck + build + a wrangler dry-run on every
pull request and non-main push.

**Or locally:**

```bash
npm run deploy         # vite build && wrangler deploy (needs wrangler login)
```

## How the moving parts fit together

**Checkout (one-time):** the cart posts to `POST /api/checkout`, which validates products
against D1, creates a Stripe Checkout Session (cart stored compactly in session metadata),
and redirects. The webhook (`checkout.session.completed`, mode `payment`) writes `orders` +
`order_items` idempotently and emails a confirmation.

**Monthly Rx Box:** `POST /api/subscribe` creates a subscription-mode Checkout Session with
inline recurring `price_data` for the chosen tier. On `checkout.session.completed` (mode
`subscription`) the webhook creates the `subscriptions` row with a **default box of
best-sellers**; the user can then pick exactly N items at `/account/customize`
(`PUT /api/account/subscription/items`). `invoice.paid` / `customer.subscription.updated` /
`.deleted` keep `status` and `next_billing_date` in sync. Billing management (cancel, pause,
card update) goes through the Stripe Customer Portal (`POST /api/account/portal`).

**AI descriptions:** generated lazily on first product view (and on demand from
`/admin/products`) with llama-3.1-8b-instruct, then cached in `products.ai_description`.
Copy follows the prescription format: *Prescribed for / Active ingredients / Dosage /
Side effects / Refills*.

**Flux images:** `/admin/image-gen` calls `POST /api/admin/products/:id/generate-image`,
which runs flux-1-schnell with a per-collection container prompt (glass jar /
parchment-wrapped butter roll / amber shaker), writes the bytes to R2 at
`products/{slug}/hero.png` (replacing any previous version), and stores the key in D1.
Images are served at `/images/products/{slug}/hero.png` with edge caching.

**Auth:** register/login issue an HS256 JWT set as an HttpOnly cookie (also returned as a
bearer token). PBKDF2-SHA256 (100k iterations) password hashing via WebCrypto. Admin routes
require `is_admin`, granted via the `ADMIN_EMAILS` allowlist.

## API surface

```
POST /api/auth/register | login | logout      GET /api/auth/me
GET  /api/products[?collection=]              GET /api/products/:slug
POST /api/quiz                                POST /api/pharmacist
GET  /api/drops                               POST /api/drops/:id/waitlist
POST /api/checkout                            POST /api/subscribe
GET  /api/account/orders                      GET /api/account/subscription
PUT  /api/account/subscription/items          POST /api/account/portal
POST /api/account/subscription/skip | pause | resume
GET  /api/account/profile | loyalty | ratings POST /api/products/:id/rate
GET|POST /api/admin/products                  PUT|DELETE /api/admin/products/:id
POST /api/admin/products/:id/generate-description
POST /api/admin/products/:id/generate-image
GET  /api/admin/orders                        PUT /api/admin/orders/:id
POST /api/webhooks/stripe                     GET /images/products/{slug}/hero.png
```
