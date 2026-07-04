import type { Env, ProductRow } from '../types';
import { runChat } from './ai';

/**
 * The affiliate resource library. Product facts are always assembled LIVE
 * from the catalog (so they can't go stale by construction); only the AI
 * enrichments (hooks, angles, dos/don'ts, promo copy) are cached in
 * library_entries, keyed by a hash of their source data. The nightly cron
 * regenerates whatever the hash says changed and drops entries whose source
 * is gone — nobody maintains this by hand.
 *
 * All copy uses {{CODE}} and {{LINK}} placeholders; the portal substitutes
 * each affiliate's own code/link so every snippet is copy-paste ready.
 */

export interface ProductEnrichment {
  hooks: string[]; // scroll-stopping first lines
  angles: string[]; // content ideas
  dos: string[];
  donts: string[];
}
export interface PromoEnrichment {
  post: string; // social caption
  story: string; // short-form / story version
  email: string; // newsletter blurb
}

async function hashOf(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STANDARD_DOS = [
  'Always disclose the partnership (#ad, #FlavorDoctorsPartner) — it builds trust and it is the law.',
  'Show the product in real cooking — application shots convert far better than jar shots.',
  'Use your code {{CODE}} out loud AND in the caption; spoken codes convert viewers who never click.',
  'Link {{LINK}} in bio/description so click-through attribution backs up the code.',
];
const STANDARD_DONTS = [
  'Never make real health or medical claims — the doctor theme is satire, not a diagnosis.',
  'Never run paid search ads on the Flavor Doctors brand name.',
  'Never post your code to coupon/deal aggregator sites — it voids the commissions.',
];

function templateProductEnrichment(p: ProductRow): ProductEnrichment {
  return {
    hooks: [
      `POV: your ${p.collection.replace('-', ' ')} game just got a prescription upgrade.`,
      `I found the cure for boring dinners and it's called ${p.name}.`,
      `Doctor's orders: put ${p.name} on literally everything this week.`,
    ],
    angles: [
      `Before/after taste test: a plain weeknight staple vs. the same dish dosed with ${p.name}.`,
      `"Filling the prescription" unboxing bit — read the Doctor's Notes on camera.`,
      `Pantry tour: where ${p.name} lives and the three things you use it on most.`,
    ],
    dos: STANDARD_DOS,
    donts: STANDARD_DONTS,
  };
}

async function generateProductEnrichment(env: Env, p: ProductRow): Promise<ProductEnrichment> {
  const fallback = templateProductEnrichment(p);
  try {
    const raw = await runChat(
      env,
      [
        {
          role: 'system',
          content: `You write an affiliate cheat-sheet for creators promoting "Flavor Doctors" (premium small-batch sauces & seasonings with a playful medical/prescription THEME — satire, never real health claims). Use {{CODE}} where their discount code goes and {{LINK}} for their link. Respond ONLY with JSON: {"hooks": [3 scroll-stopping first lines], "angles": [3 specific, actually-filmable content ideas], "dos": [2 product-specific tips], "donts": [1 product-specific pitfall]}. Practical over cute; no health claims anywhere.`,
        },
        { role: 'user', content: `Product: ${p.name} ($${(p.price / 100).toFixed(2)}, ${p.collection}) — ${p.description}` },
      ],
      600
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<ProductEnrichment>;
    return {
      hooks: (parsed.hooks ?? []).filter((s) => typeof s === 'string').slice(0, 3).length >= 2 ? parsed.hooks!.slice(0, 3) : fallback.hooks,
      angles: (parsed.angles ?? []).filter((s) => typeof s === 'string').slice(0, 3).length >= 2 ? parsed.angles!.slice(0, 3) : fallback.angles,
      dos: [...((parsed.dos ?? []).filter((s) => typeof s === 'string').slice(0, 2) as string[]), ...STANDARD_DOS],
      donts: [...((parsed.donts ?? []).filter((s) => typeof s === 'string').slice(0, 1) as string[]), ...STANDARD_DONTS],
    };
  } catch {
    return fallback;
  }
}

function templatePromoEnrichment(promo: { name: string; code: string; percent_off: number; ends_at: string }): PromoEnrichment {
  const ends = new Date(promo.ends_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return {
    post: `🚨 The clinic is running a special: ${promo.name} — ${promo.percent_off}% off through ${ends}. Stack it with my code {{CODE}} on your first order and thank me later. {{LINK}}`,
    story: `${promo.percent_off}% off at Flavor Doctors until ${ends} 🩺 my code: {{CODE}}`,
    email: `Flavor Doctors just opened "${promo.name}" — ${promo.percent_off}% off everything until ${ends}. If you've been waiting to try the stuff I keep talking about, this is the window: {{LINK}} (code {{CODE}}).`,
  };
}

async function generatePromoEnrichment(env: Env, promo: { name: string; code: string; percent_off: number; ends_at: string }): Promise<PromoEnrichment> {
  const fallback = templatePromoEnrichment(promo);
  try {
    const raw = await runChat(
      env,
      [
        {
          role: 'system',
          content: `Write ready-to-post promo copy for affiliates of "Flavor Doctors" (medical-satire sauce brand). Use {{CODE}} and {{LINK}} placeholders. Respond ONLY with JSON: {"post": <social caption ≤300 chars>, "story": <story overlay ≤100 chars>, "email": <newsletter blurb ≤400 chars>}. Include the deadline. No health claims.`,
        },
        { role: 'user', content: `Sale: "${promo.name}" — ${promo.percent_off}% off, ends ${promo.ends_at}.` },
      ],
      500
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<PromoEnrichment>;
    return {
      post: typeof parsed.post === 'string' && parsed.post.trim() ? parsed.post.trim() : fallback.post,
      story: typeof parsed.story === 'string' && parsed.story.trim() ? parsed.story.trim() : fallback.story,
      email: typeof parsed.email === 'string' && parsed.email.trim() ? parsed.email.trim() : fallback.email,
    };
  } catch {
    return fallback;
  }
}

const MAX_GENERATIONS_PER_RUN = 12; // bound nightly AI usage

/**
 * Nightly reconciliation: regenerate stale/missing kits, drop kits whose
 * product or promotion is gone. Returns counts for the cron log.
 */
export async function refreshLibrary(env: Env): Promise<{ generated: number; removed: number }> {
  let generated = 0;
  let removed = 0;

  const [{ results: products }, { results: promos }, { results: entries }] = await Promise.all([
    env.DB.prepare('SELECT * FROM products WHERE is_active = 1').all<ProductRow>(),
    env.DB.prepare("SELECT id, name, code, percent_off, ends_at FROM promotions WHERE is_active = 1 AND ends_at > datetime('now')").all<{
      id: string;
      name: string;
      code: string;
      percent_off: number;
      ends_at: string;
    }>(),
    env.DB.prepare('SELECT kind, ref, source_hash FROM library_entries').all<{ kind: string; ref: string; source_hash: string }>(),
  ]);
  const byKey = new Map(entries.map((e) => [`${e.kind}:${e.ref}`, e.source_hash]));

  for (const p of products) {
    if (generated >= MAX_GENERATIONS_PER_RUN) break;
    const hash = await hashOf(`${p.name}|${p.description}|${p.price}|${p.collection}`);
    if (byKey.get(`product_kit:${p.id}`) === hash) continue;
    const enrichment = await generateProductEnrichment(env, p);
    await env.DB.prepare(
      `INSERT INTO library_entries (kind, ref, source_hash, title, content_json, updated_at) VALUES ('product_kit', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (kind, ref) DO UPDATE SET source_hash = excluded.source_hash, title = excluded.title, content_json = excluded.content_json, updated_at = datetime('now')`
    )
      .bind(p.id, hash, p.name, JSON.stringify(enrichment))
      .run();
    generated++;
  }

  for (const promo of promos) {
    if (generated >= MAX_GENERATIONS_PER_RUN) break;
    const hash = await hashOf(`${promo.name}|${promo.code}|${promo.percent_off}|${promo.ends_at}`);
    if (byKey.get(`promo_kit:${promo.id}`) === hash) continue;
    const enrichment = await generatePromoEnrichment(env, promo);
    await env.DB.prepare(
      `INSERT INTO library_entries (kind, ref, source_hash, title, content_json, updated_at) VALUES ('promo_kit', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (kind, ref) DO UPDATE SET source_hash = excluded.source_hash, title = excluded.title, content_json = excluded.content_json, updated_at = datetime('now')`
    )
      .bind(promo.id, hash, promo.name, JSON.stringify(enrichment))
      .run();
    generated++;
  }

  // Retired products / ended promotions leave the library automatically.
  const liveProductIds = new Set(products.map((p) => p.id));
  const livePromoIds = new Set(promos.map((p) => p.id));
  for (const e of entries) {
    const gone =
      (e.kind === 'product_kit' && !liveProductIds.has(e.ref)) || (e.kind === 'promo_kit' && !livePromoIds.has(e.ref));
    if (gone) {
      await env.DB.prepare('DELETE FROM library_entries WHERE kind = ? AND ref = ?').bind(e.kind, e.ref).run();
      removed++;
    }
  }
  return { generated, removed };
}

// ---------- Evergreen playbooks (written once; no maintenance) ----------

export const PLAYBOOKS = [
  {
    slug: 'first-week',
    title: 'Your First Week: from zero to first commission',
    body: [
      'Day 1 — Post an honest first-impressions unboxing. Read the Doctor\'s Notes on camera; the prescription bit does the comedy for you. Say your code {{CODE}} out loud and put {{LINK}} in your bio.',
      'Day 2-3 — Cook with ONE product on something your audience already makes weekly (chicken, burgers, eggs). Application content outsells announcement content roughly 3:1.',
      'Day 4-5 — Share the result + a poll or question ("what should I doctor next?"). Engagement teaches the algorithm who your buyers are.',
      'Day 6-7 — Post your genuine ranking of what you tried. Ranked lists are the highest-converting affiliate format in food.',
      'Commissions appear in your portal instantly, clear after the 30-day refund window, and pay out monthly once you cross $25.',
    ],
  },
  {
    slug: 'ftc-disclosure',
    title: 'Disclosure: the 30-second version that keeps everyone safe',
    body: [
      'You earn money from these links and codes, so US law (FTC) requires you to say so, clearly, BEFORE the link/code — not buried in tags.',
      'Easy compliant patterns: "#ad", "#FlavorDoctorsPartner", or just saying "they sponsor me / I earn from this code" on camera.',
      'It must be on EVERY post, story, and video — not just your first one. Platform disclosure toggles (Paid Partnership labels) are great; use them AND a verbal/caption mention.',
      'Non-negotiable: we remove affiliates for missing disclosures, because the fines land on both of us.',
    ],
  },
  {
    slug: 'brand-voice',
    title: 'The bit: how to play doctor without getting anyone in trouble',
    body: [
      'The theme is a PRESCRIPTION PARODY: diagnose boring dinners, prescribe flavor, warn about side effects like "eating this on everything". Lean in — write your captions like chart notes.',
      'The hard line: never claim the products heal, treat, prevent, or cure anything real. No "anti-inflammatory ghee", no "gut-health ranch". The moment it sounds like WebMD instead of a sitcom, delete it.',
      'Words that work: prescribed, dosage, refills, chronic blandness, treatment plan, side effects. Words that get us both in trouble: cures, heals, boosts immunity, anti-anything.',
      'Photography: warm kitchen light, real food, jars in action. The label is the costume; the food is the star.',
    ],
  },
  {
    slug: 'how-money-works',
    title: 'How the money works (rates, tiers, payouts)',
    body: [
      'You earn {{FIRST_PCT}}% of every first order you send and {{RECURRING_PCT}}% of subscription renewals for the customer\'s first year. Your code gives buyers 15% off, so everybody wins.',
      'Tiers: Resident (start) → Attending at $1,000 attributed revenue (28%/12%) → Chief of Medicine at $5,000 (30%/15% + early drop access). Tier upgrades apply automatically.',
      'Commissions clear after the 30-day refund window (45 days during your first probation month). Refunded orders claw back automatically — clean traffic is profitable traffic.',
      'Payouts run monthly once your cleared balance passes $25: cash via Stripe (connect your bank in the portal) or store credit at 1.25× if you\'d rather eat your earnings.',
    ],
  },
];
