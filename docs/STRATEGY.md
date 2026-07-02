# Flavor Doctors — Competitive Strategy Memo

*Synthesized July 2026 from four research sweeps: competitive landscape, retention/churn playbooks, pricing benchmarks, and engagement/stickiness patterns. Figures are search-verified 2025–26 listings; spot-check before repricing.*

## 1. Position: we already occupy unoccupied territory — market it

Research across every sauce/spice/butter subscription found **no direct analog** to our box. Every competitor is single-lane and most refuse choice:

| Competitor | Offer | Weakness |
| --- | --- | --- |
| Fuego Box | 1–3 hot sauces, $12.95–29.95 + ~$5 ship | FAQ tells picky eaters "DO NOT sign-up" — zero customization |
| Heatonist / Hot Ones | 3 sauces $30/mo + $6 ship | Shipping on every box; documented breakage complaints |
| Burlap & Barrel Spice Club | 4 jars $49.99/qtr | Team-selected only, policy no-choice |
| Amazing Clubs | 2 bottles/mo | 2.0/5 PissedConsumer; cancellation/refund friction |
| RawSpiceBar | $10/mo | 1.0/5 trust scores; failed cancellations, unauthorized renewals |
| Ploughgate (butter) | $28/3×8oz | Only real butter subscription; micro-scale, no brand |

Our structural advantages that nobody matches: **cross-category** (mayo + butter + burger sauce + dessert + seasoning in one box), **full subscriber choice** (pick all 4/6/8 items), **free shipping on a monthly plan**, **sweet + savory**, **cold-chain capability** (butters — a moat competitors' shelf-stable assortments can't follow), and a **theme** (nobody in the category has one; the closest analog is Hot Ones' media tie-in).

Per-item math: our $8.63–9.75/item with free shipping and full choice vs Heatonist's effective ~$12/sauce and B&B's $12.50/jar.

**Action: lead every page and ad with "the only box where you choose everything — 5 categories, free shipping." That sentence is unanswerable by any current competitor.**

## 2. Undercut plan (pricing)

$/oz verdicts vs market:
- **Burger sauces** ($1.12–1.19/oz): well-positioned, 55–65% under TRUFF. Hold.
- **Fry seasonings** ($2.00–2.50/oz): correctly priced just under Spicewalla ($2.45–2.55). Hold.
- **Mayo**: $8.99 entry undercuts TRUFF DTC ~10% (good); $11.99 top-end overcuts TRUFF ~20% — needs a halo anchor.
- **Dessert sauces**: $10.99 in-market; $12.99 is 6–18% over the priciest artisan comp (King's Cupboard $1.46–1.53/oz). Cap at $11.99.
- **Compound butter**: most overcut — $2.75–3.75/oz vs Epicurean $1.43–2.33 and Banner ~$1.25. Cold chain justifies some premium but not all of it.

Five plays:
1. **Free shipping at $45 à la carte, $6.95 flat below** (AOV × 15–25% rule). Undercuts Stonewall's $99 gate and typical food-DTC ~$100 thresholds. Boxes stay free-ship.
2. **Say the subscription math out loud**: the $69/8-item box already implies ~18% savings + free shipping — reprice messaging as "save 18/22/25%" by tier. Add first-box **20% off** (beats Fuego's 10% norm; matches TRUFF's subscribe tier).
3. **"Any 3 for $27.99" build-a-bundle** (Graza Trio pattern) — lifts AOV toward the free-ship line and makes the $39 box the obvious upgrade.
4. **Halo SKU**: limited "Doctor's Reserve" truffle mayo/butter at $16.99–18.99 (TRUFF sells white-truffle at $31/6oz; Sabatino zest clears $8.50–15/oz). Re-anchors core mayo as mid-tier and legitimizes $14.99 butter. Optionally drop entry mayo to $7.99.
5. **Unbundle cold-chain**: $4.95 capped "chill pack" fee on butter orders under $45 (waived on boxes) — looks generous vs Banner's full pass-through, lets butter stickers drop $1–2 while netting the same. Floor discipline: never below ~$7.50/jar or $1.60/oz on seasonings.

## 3. Churn plan (sequenced by ROI-per-hour)

Benchmarks: food boxes churn 10–18%/mo; best-in-class <6%; replenishment-style consumables 5–8%. **44% of cancels happen in the first 90 days.** Failed payments = 20–40% of all churn (~9% of revenue), and recovery programs reach 70%+.

**Week 1 — Stripe dashboard config, zero code:**
- Smart Retries + automatic card updater + failed-payment emails (dunning).
- Customer-portal cancellation reasons (on by default) + retention coupon offer.

**Weeks 2–6 — custom builds (the portal can't do these):**
- **"Skip this month" / "Pause 1–3 months"** buttons in My Chart (`pause_collection`). Pausers return at 40–60% vs 3–10% for canceled-then-won-back; skip/pause availability influences 79% of subscribe decisions.
- **Every-2-months cadence** at every tier. Our sharpest structural risk is *stockpile churn* — a sauce box is slow-consumption, so monthly over-serves many households. Auto-offer the downshift after two skips.
- Onboarding arc for boxes 1–3 ("if you get three boxes, we got you" — ButcherBox): quick-win recipe card in box 1, day-7 check-in, pre-box-2 pick-your-items nudge, month-3 surprise credit at the cohort cliff.
- Win-back segments by cancel reason at 30/60/90 days (10–15% reactivation inside 90 days; <5% after ~120).

**Months 2–4:** referral (give-$15/get-$15; referred subscribers show 37% higher 12-month retention), loyalty with **bonus-item-slot** redemption (costs us wholesale, drives the pick-items habit), milestone surprise items at months 2–3, prepaid 3/6/12-box terms (annual-billed churn 51% less).

KPI targets: month-3 cohort survival ↑, cancel-flow save rate 25–35%, dunning recovery 60–70%, "too much product" cancel-reason share trending down.

## 4. Stickiness roadmap (features, effort-rated for our stack)

Everything below runs on existing D1/Workers AI/Stripe plumbing; the only new platform primitive needed is a Cron Trigger. (S = <1 day, M = 1–3 days, L = ~1 week.)

1. **The Intake Exam** (M) — flavor-diagnosis quiz (Bright Cellars proxy-question style); Workers AI writes a Diagnosis ("Acute Blandness, Stage 2") + 3-SKU Prescription, stored on the user. Quizzes convert 37–55% of completers and lift AOV 11–15% (Hungryroot's quiz-fed AI picks 70% of what customers buy; SmartCart users order 2×).
2. **Flavor Health Record** (M) — My Chart becomes the retention hook: 1-click "How did the treatment work?" ratings feed the profile so recommendations improve the longer you stay (Bright Cellars' loop — the algorithm *is* the retention).
3. **Refill Reminders** (S–M) — per-SKU "dosage supply" windows; nightly cron emails "Your Rx is running low" at ~75% of window with one-click reorder. Replenishment emails convert 8–15% vs 1–3% promo.
4. **The Pharmacist** (M) — AI consult chat grounded in the catalog ("describe your symptoms" → product + usage in doctor voice). Live precedents: sommelier.bot, Instacart AI.
5. **Clinical Trials** (M) — quarterly limited-edition drops: teaser → "enroll in the trial" waitlist → **48h subscriber-only window** → public → sold-out archive. Limited editions lift purchase intent ~31%; the members-first window strengthens the box.
6. **Board Certification** (M) — points + tiers (*Patient → Resident → Attending → Chief of Medicine*); perks: member pricing, drop early access, tier-exclusive flavor. VIP-tier members show +73% AOV in food-DTC benchmarks.
7. **Treatment Protocols** (M–L) — shoppable recipe hub with recipe schema (up to +82% CTR; 66% of consumers have bought a product seen in an online recipe). AI-drafted, admin-approved. This is also the consumption engine — customers who cook with the products don't stockpile-churn.
8. **The Prescription Pad** (S–M) — AI-generated shareable prescription slip (name, diagnosis, Rx, doctor signature) as an OG-card/image after quiz or purchase. Build the artifact people want to post (the Graza lesson).
9. **Second Opinions** (M) — UGC "off-label uses" submissions; winners get points + "Published in the Journal of Flavor Medicine."
10. **House Calls** (S on-site) — theme-maxxed merch and a subscriber "insurance card" (Liquid Death's wallet-pass move; their merch is $3M of $45M revenue). Never break character anywhere: transactional emails, 404s, loyalty names.

## 5. 90-day sequence

- **Week 1**: Stripe revenue-recovery config; cancel reasons + retention coupon; box-savings % messaging; first-box 20%.
- **Weeks 2–4**: skip/pause buttons; every-2-months cadence; $45 free-ship + Any-3 bundle; refill-reminder cron.
- **Month 2**: Intake Exam + Flavor Health Record (the data spine); onboarding email arc; win-back segments.
- **Month 3**: Clinical Trial drop #1 with subscriber early window; Board Certification tiers; The Pharmacist; Prescription Pad shareable.

The through-line: competitors sell curation with no choice, charge for shipping, and have no theme. We sell **choice, free shipping, and a bit** — and every retention mechanic above deepens one of those three.
