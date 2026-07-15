import type { ProductRow, RequestContext } from '../types';
import { COLLECTIONS } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { generateDescription } from '../lib/ai';
import { getAuthUser } from '../lib/auth';

// Public stock signal: untracked SKUs (no inventory lots yet) count as in
// stock; tracked SKUs are out once their ledger hits zero.
type StockedRow = ProductRow & { on_hand: number | null };
const STOCK_JOIN =
  'LEFT JOIN (SELECT product_id, SUM(delta) AS on_hand FROM inventory_moves GROUP BY product_id) inv ON inv.product_id = p.id';

export function publicProduct(p: ProductRow & { on_hand?: number | null }) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    collection: p.collection,
    description: p.description,
    aiDescription: p.ai_description,
    price: p.price,
    imageUrl: p.image_r2_key ? `/images/${p.image_r2_key}` : null,
    isBestseller: p.is_bestseller === 1,
    isDrop: p.is_drop === 1,
    dropStartsAt: p.drop_starts_at,
    dropStock: p.drop_stock,
    ingredients: p.ingredients ?? null,
    allergens: p.allergens ?? null,
    inStock: p.on_hand === undefined || p.on_hand === null ? true : p.on_hand > 0,
  };
}

export async function listProducts(req: Request, rc: RequestContext): Promise<Response> {
  const collection = new URL(req.url).searchParams.get('collection');
  let stmt;
  if (collection) {
    if (!(COLLECTIONS as readonly string[]).includes(collection)) {
      return errorResponse('Unknown collection', 404);
    }
    stmt = rc.env.DB.prepare(
      `SELECT p.*, inv.on_hand FROM products p ${STOCK_JOIN} WHERE p.is_active = 1 AND p.is_drop = 0 AND p.collection = ? ORDER BY p.name`
    ).bind(collection);
  } else {
    stmt = rc.env.DB.prepare(
      `SELECT p.*, inv.on_hand FROM products p ${STOCK_JOIN} WHERE p.is_active = 1 AND p.is_drop = 0 ORDER BY p.collection, p.name`
    );
  }
  const { results } = await stmt.all<StockedRow>();
  return json({ products: results.map(publicProduct) });
}

export async function getProduct(_req: Request, rc: RequestContext): Promise<Response> {
  const product = await rc.env.DB.prepare(
    `SELECT p.*, inv.on_hand FROM products p ${STOCK_JOIN} WHERE p.slug = ? AND p.is_active = 1`
  )
    .bind(rc.params.slug)
    .first<StockedRow>();
  if (!product) return errorResponse('Product not found', 404);

  // Lazily generate + cache the prescription-style description on first view.
  if (!product.ai_description) {
    try {
      const desc = await generateDescription(rc.env, product);
      await rc.env.DB.prepare('UPDATE products SET ai_description = ? WHERE id = ?').bind(desc, product.id).run();
      product.ai_description = desc;
    } catch (err) {
      console.error(`AI description generation failed for ${product.slug}:`, err);
    }
  }

  // Published Treatment Plans featuring this product (recipe hub cross-links).
  const { results: recipes } = await rc.env.DB.prepare(
    'SELECT slug, title FROM recipes WHERE product_id = ? AND is_published = 1 ORDER BY created_at DESC LIMIT 5'
  )
    .bind(product.id)
    .all<{ slug: string; title: string }>();

  return json({ product: publicProduct(product), recipes });
}

/** Back-in-stock alert signup ("notify me when it's back"). */
export async function restockAlert(req: Request, rc: RequestContext): Promise<Response> {
  const user = await getAuthUser(req, rc.env);
  const body = await readJson<{ email?: string }>(req);
  const email = (user?.email ?? body?.email ?? '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse('A valid email is required');
  const product = await rc.env.DB.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1')
    .bind(rc.params.id)
    .first();
  if (!product) return errorResponse('Product not found', 404);
  await rc.env.DB.prepare(
    'INSERT INTO restock_alerts (email, product_id) VALUES (?, ?) ON CONFLICT (email, product_id) DO UPDATE SET notified = 0'
  )
    .bind(email, rc.params.id)
    .run();
  return json({ ok: true, message: "We'll email you the moment it's back." });
}

/** Default box contents: best-sellers first, then cheapest actives as filler. */
export async function defaultBoxItems(rc: RequestContext, count: number): Promise<string[]> {
  const { results } = await rc.env.DB.prepare(
    'SELECT id FROM products WHERE is_active = 1 AND is_drop = 0 ORDER BY is_bestseller DESC, price ASC LIMIT ?'
  )
    .bind(count)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}
