import type { Env, ProductRow } from '../types';
import { runChatLogged } from './ai';
import { getBrand } from './brand';
import { newId } from './util';

/**
 * The product-event social generator: drains pending mkt_events and turns
 * each into an editable draft kit, grounded STRICTLY in product-record facts.
 * AI never invents ingredients, prices, or dates; when AI is unavailable the
 * generator falls back to honest fact-based templates so the rail never
 * stalls. Drafts only — nothing auto-posts or auto-sends, ever.
 */

export interface KitContent {
  instagram: string;
  tweet: string;
  email_md: string;
  blurb: string;
}

interface EventRow {
  id: number;
  kind: string;
  subject_id: string;
  payload: string | null;
  attempts: number;
}

const KIND_TO_DRAFT: Record<string, { draftKind: string; label: string }> = {
  product_published: { draftKind: 'launch_kit', label: 'Launch kit' },
  drop_live: { draftKind: 'launch_kit', label: 'Drop-day kit' },
  back_in_stock: { draftKind: 'back_in_stock', label: 'Back-in-stock kit' },
  low_stock: { draftKind: 'low_stock', label: 'Low-stock kit' },
};

export async function processPendingEvents(env: Env, limit = 5): Promise<number> {
  const { results: events } = await env.DB.prepare(
    "SELECT id, kind, subject_id, payload, attempts FROM mkt_events WHERE status IN ('pending','failed') AND attempts < 3 ORDER BY id LIMIT ?"
  )
    .bind(limit)
    .all<EventRow>();

  let drafted = 0;
  for (const ev of events) {
    try {
      const product = await env.DB.prepare('SELECT * FROM products WHERE id = ?')
        .bind(ev.subject_id)
        .first<ProductRow>();
      if (!product) {
        await env.DB.prepare("UPDATE mkt_events SET status = 'skipped', processed_at = datetime('now'), error = 'product missing' WHERE id = ?")
          .bind(ev.id)
          .run();
        continue;
      }
      const meta = KIND_TO_DRAFT[ev.kind] ?? KIND_TO_DRAFT.product_published;
      const content = await generateKit(env, ev.kind, product);
      await env.DB.prepare(
        'INSERT INTO mkt_drafts (id, event_id, product_id, kind, title, content) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(newId('d'), ev.id, product.id, meta.draftKind, `${meta.label} — ${product.name}`, JSON.stringify(content))
        .run();
      await env.DB.prepare("UPDATE mkt_events SET status = 'drafted', processed_at = datetime('now') WHERE id = ?")
        .bind(ev.id)
        .run();
      drafted++;
    } catch (err) {
      await env.DB.prepare(
        "UPDATE mkt_events SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?"
      )
        .bind(err instanceof Error ? err.message : String(err), ev.id)
        .run();
      console.error(`Social kit generation failed for event ${ev.id}:`, err);
    }
  }
  return drafted;
}

async function generateKit(env: Env, kind: string, p: ProductRow): Promise<KitContent> {
  const facts = [
    `Product: ${p.name}`,
    `Category: ${p.collection}`,
    `Description: ${p.description}`,
    p.ingredients ? `Ingredients: ${p.ingredients}` : null,
    `Price: $${(p.price / 100).toFixed(2)}`,
    `URL: https://flavordoctors.com/product/${p.slug}`,
  ]
    .filter(Boolean)
    .join('\n');

  const angle =
    kind === 'back_in_stock'
      ? 'It is BACK IN STOCK after selling out. Warm "it\'s back" energy — reward the people who waited.'
      : kind === 'low_stock'
        ? 'It is genuinely RUNNING LOW (small batch). Honest urgency only: real scarcity, stated plainly, zero fake-countdown tactics.'
        : 'It is NEWLY AVAILABLE. Launch energy: introduce it, make people taste it in their heads.';

  if (env.AI) {
    try {
      const brand = await getBrand(env);
      const raw = await runChatLogged(
        env,
        `social_kit:${kind}`,
        [
          {
            role: 'system',
            content: `You write marketing copy for ${brand.name}. Brand voice: ${brand.voice}
HARD RULES: Use ONLY the facts provided — never invent ingredients, prices, dates, or claims. Output STRICT JSON with exactly these keys and nothing else (no markdown fences): {"instagram": string, "tweet": string, "email_md": string, "blurb": string}. instagram: caption ≤ 120 words with 3-5 relevant hashtags. tweet: ≤ 250 chars. email_md: 2 short markdown paragraphs for a newsletter section, may use **bold** and the product URL as a link. blurb: one sentence ≤ 30 words.`,
          },
          { role: 'user', content: `${angle}\n\nFACTS:\n${facts}` },
        ],
        900
      );
      const parsed = JSON.parse(raw.replace(/^```(json)?\s*|\s*```$/g, '')) as Partial<KitContent>;
      if (parsed.instagram && parsed.tweet && parsed.email_md && parsed.blurb) {
        return parsed as KitContent;
      }
      throw new Error('AI kit missing keys');
    } catch (err) {
      console.error('AI kit generation failed; using template fallback:', err);
    }
  }

  // Honest template fallback — facts only, no AI required.
  const url = `https://flavordoctors.com/product/${p.slug}`;
  const price = `$${(p.price / 100).toFixed(2)}`;
  const line =
    kind === 'back_in_stock'
      ? `${p.name} is back in stock.`
      : kind === 'low_stock'
        ? `Small batch alert: ${p.name} is running low.`
        : `New treatment on the shelf: ${p.name}.`;
  return {
    instagram: `${line} ${p.description} ${price} — link in bio. #flavordoctors #smallbatch #${p.collection.replace(/-/g, '')}`,
    tweet: `${line} ${p.description}`.slice(0, 240) + ` ${url}`,
    email_md: `**${line}**\n\n${p.description} Yours for ${price} — [take a look](${url}).`,
    blurb: `${line} ${p.description}`.slice(0, 180),
  };
}
