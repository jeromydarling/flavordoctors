# Marketing Platform (Brand Studio · Event Spine · Outbox · CRM)

Built in phases against the spec adapted 2026-07. Status legend: ✅ shipped, ⏳ planned.

## ✅ Phase 1 — Brand Studio + email shell + compliance (d8afc6f)

- `brand_settings` (key-value; code defaults in `src/worker/lib/brand.ts` ARE the
  current brand — empty table changes nothing). Edit at **Admin → Brand Studio**
  with live preview. The `voice` field steers all AI-generated copy.
- `renderBrandedEmail()` (`src/worker/lib/emailShell.ts`): the one shell every
  outbound email renders through — marketing and transactional — table layout,
  inline styles, plain-text alternative, CAN-SPAM footer (postal address from
  brand settings, `BUSINESS_ADDRESS` var overrides).
- Compliance: permanent `mkt_suppression` (unsubscribes + provider bounces),
  checked at queue AND send time; unsubscribe is POST-to-act (GET renders a
  confirm page; RFC 8058 one-click POST honored); configurable Reply-To.

## ✅ Phase 2 — Event spine + social generator (d89da02)

- `mkt_events`: idempotent trigger rail (UNIQUE dedupe_key). Emitters:
  product publish (create or inactive→active, once per product ever),
  drop-live sweep, back-in-stock (restock cron), low-stock (weekly, only while
  purchasable — honest urgency enforced in code).
- Generator (`src/worker/lib/socialKits.ts`): drains events on the 10-min cron
  or the **Generate now** button; produces editable kits {instagram, tweet,
  email_md, blurb} in brand voice via Workers AI, grounded strictly in
  product-record facts, honest template fallback without AI. Drafts only —
  nothing ever auto-posts.
- **Admin → Marketing → Auto-drafted kits**: edit, archive, or "To composer"
  (converts email_md into a draft campaign). `ai_usage` ledger logs every call.

## ✅ Phase 3 — Paced outbox (3d47443)

- `mkt_sends`: queue + permanent ledger, UNIQUE(broadcast_id, email).
- 2-minute cron drains `OUTBOX_BATCH` (default 10) per tick; atomic claim via
  UPDATE…RETURNING before any network call; stale claims recovered after 15 min.
- Error taxonomy: permanent → failed (no retry); throttle → whole broadcast
  parked 1h without burning attempts; transient → 15/30-min backoff, 3 strikes.
- Campaign send = enqueue; card shows queue state + manual drain
  (`POST /api/admin/marketing/outbox/drain?batch=N`, cap 500).

## ⏳ Phase 4 — Vendor & Distributor CRM

Tables `crm_contacts` (upsert by email, "fill blanks, never overwrite what a
human wrote"), `crm_interactions` (auto + manual timeline; every outbound email
logs `email_out`), `crm_tasks` (daily sweep auto-files follow-ups; quiet-too-long
flips status to at_risk). CRM page: list + filters, detail with timeline,
compose-through-shell. B2B segments feed the broadcast composer. Optional:
Cloudflare Email Routing handler for inbound replies (needs dashboard setup).

## ⏳ Phase 5 — Video-spot connectors (top priority after CRM)

Marketing Studio "generate video spot": brief/product → Higgsfield platform API
(kling image-to-video; `Authorization: Key <key>:<secret>`; single-clip 10–15s
spots with in-model sound) + ElevenLabs REST (VO/music/SFX/alignment) → result
imported to R2 via the existing `media_imports` cron → preview/download in
admin. Workers can't run ffmpeg: multi-shot assembly stays agent-side.
Prereqs: rotate the ElevenLabs key → Worker secret `ELEVENLABS_API_KEY`;
fund the Higgsfield API wallet; secrets `HIGGSFIELD_KEY`/`HIGGSFIELD_SECRET`.
Log external calls into `ai_usage` (providers `elevenlabs`, `higgsfield`).

## Deferred / notes

- Lifecycle sequences (spec 3c) partially exist as `flows`; migrating them onto
  the outbox + a per-(sequence, contact) state table is folded into Phase 4/5
  follow-up. Referrals: EXTEND the existing points-based program (per Jeromy) —
  do not build the parallel credits ledger from the spec.
- Sentry: reporter is wired (`SENTRY_DSN` var); org policy blocked API project
  creation — create the project manually at cros-llc.sentry.io and set the DSN.
- All money integer cents; emails lowercased at compare/store boundaries; new
  tables prefixed `mkt_`/`crm_`/`brand_`; every feature degrades cleanly when
  config is missing (no email binding → honest logged no-ops).
