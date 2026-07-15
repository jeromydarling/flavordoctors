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

## ✅ Phase 4 — Vendor & Distributor CRM

Tables `crm_contacts` (upsert by email, "fill blanks, never overwrite what a
human wrote"), `crm_interactions` (auto + manual timeline; every outbound email
logs `email_out`), `crm_tasks` (daily sweep auto-files follow-ups; quiet-too-long
flips status to at_risk). CRM page: list + filters, detail with timeline,
compose-through-shell. B2B segments feed the broadcast composer. Optional:
Cloudflare Email Routing handler for inbound replies (needs dashboard setup).

## ✅ Phase 5 — Video-spot connectors

Marketing Studio "Video spots" panel: brief + product → AI-drafted, editable
motion prompt (brand voice, grounded in product facts; honest template when AI
is off) → Higgsfield platform API animates the real product photo
(`kling-video/v2.5-turbo/pro/image-to-video` by default, override via
`HIGGSFIELD_VIDEO_MODEL`; `Authorization: Key <key>:<secret>`) → the 10-min
cron polls `/requests/{id}/status` and hands the finished clip to the existing
`media_imports` pipeline → R2 `cdn/spots/<id>.mp4`, previewable in admin.
ElevenLabs generates optional VO (Brian by default, `ELEVENLABS_VOICE_ID` to
override) and music beds straight into R2 (`-vo.mp3`/`-music.mp3`); Workers
can't run ffmpeg, so muxing stays agent-side. Table `mkt_spots` (migration
0015) tracks drafting → generating → importing → ready|failed. All external
calls logged to `ai_usage` (providers `higgsfield`, `elevenlabs`). Degrades
cleanly: without secrets, drafting/editing works and submit/audio return an
honest 503 (banner in the UI says exactly which secrets to set).
Prereqs to go live (user-side): rotate the ElevenLabs key → Worker secret
`ELEVENLABS_API_KEY`; secrets `HIGGSFIELD_KEY`/`HIGGSFIELD_SECRET`; fund the
Higgsfield API wallet.

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
