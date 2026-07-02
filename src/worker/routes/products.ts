import type { ProductRow, RequestContext } from '../types';
import { COLLECTIONS } from '../types';
import { json, errorResponse } from '../lib/util';
import { generateDescription } from '../lib/ai';

export function publicProduct(p: ProductRow) {
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
      'SELECT * FROM products WHERE is_active = 1 AND is_drop = 0 AND collection = ? ORDER BY name'
    ).bind(collection);
  } else {
    stmt = rc.env.DB.prepare('SELECT * FROM products WHERE is_active = 1 AND is_drop = 0 ORDER BY collection, name');
  }
  const { results } = await stmt.all<ProductRow>();
  return json({ products: results.map(publicProduct) });
}

export async function getProduct(_req: Request, rc: RequestContext): Promise<Response> {
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE slug = ? AND is_active = 1')
    .bind(rc.params.slug)
    .first<ProductRow>();
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

  return json({ product: publicProduct(product) });
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
