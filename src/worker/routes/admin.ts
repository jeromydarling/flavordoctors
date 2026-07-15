import type { OrderRow, ProductRow } from '../types';
import { COLLECTIONS } from '../types';
import { json, errorResponse, newId, readJson, slugify } from '../lib/util';
import { requireAdmin, requireStaff } from '../lib/auth';
import { audit } from '../lib/audit';
import { generateDescription, generateProductImage } from '../lib/ai';
import { publicProduct } from './products';
import { attachItems } from './account';

const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'canceled', 'refunded'];

function adminProduct(p: ProductRow) {
  return { ...publicProduct(p), isActive: p.is_active === 1, createdAt: p.created_at };
}

interface ProductInput {
  name?: string;
  collection?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
  isBestseller?: boolean;
  isDrop?: boolean;
  dropStartsAt?: string | null;
  dropStock?: number | null;
}

function validateProductInput(body: ProductInput | null): string | null {
  if (!body) return 'Invalid JSON body';
  if (!body.name?.trim()) return 'name is required';
  if (!body.collection || !(COLLECTIONS as readonly string[]).includes(body.collection)) {
    return `collection must be one of: ${COLLECTIONS.join(', ')}`;
  }
  if (!body.description?.trim()) return 'description is required';
  if (!Number.isInteger(body.price) || (body.price as number) <= 0) return 'price must be a positive integer (cents)';
  if (body.isDrop) {
    if (!body.dropStartsAt || Number.isNaN(Date.parse(body.dropStartsAt))) {
      return 'dropStartsAt (ISO timestamp) is required for Clinical Trial drops';
    }
    if (body.dropStock !== null && body.dropStock !== undefined && (!Number.isInteger(body.dropStock) || body.dropStock < 0)) {
      return 'dropStock must be a non-negative integer or null (unlimited)';
    }
  }
  return null;
}

function dropBindings(b: ProductInput): [number, string | null, number | null] {
  return [
    b.isDrop ? 1 : 0,
    b.isDrop ? new Date(b.dropStartsAt!).toISOString() : null,
    b.isDrop ? (b.dropStock ?? null) : null,
  ];
}

// --- Products CRUD ---

export const adminListProducts = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT * FROM products ORDER BY collection, name').all<ProductRow>();
  return json({ products: results.map(adminProduct) });
});

export const adminCreateProduct = requireAdmin(async (req, rc) => {
  const body = await readJson<ProductInput & { ingredients?: string | null; allergens?: string | null }>(req);
  const err = validateProductInput(body);
  if (err) return errorResponse(err);
  const b = body!;
  const id = newId('p');
  const slug = slugify(b.name!);
  const dup = await rc.env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
  if (dup) return errorResponse(`A product with slug "${slug}" already exists`, 409);
  await rc.env.DB.prepare(
    'INSERT INTO products (id, slug, name, collection, description, price, is_active, is_bestseller, is_drop, drop_starts_at, drop_stock, ingredients, allergens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id, slug, b.name!.trim(), b.collection, b.description!.trim(), b.price,
      b.isActive === false ? 0 : 1, b.isBestseller ? 1 : 0, ...dropBindings(b),
      b.ingredients?.trim() || null, b.allergens?.trim() || null
    )
    .run();
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<ProductRow>();
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'product_create', id, b.name!.trim()));
  return json({ product: adminProduct(product!) }, 201);
});

export const adminUpdateProduct = requireAdmin(async (req, rc) => {
  const existing = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(rc.params.id).first<ProductRow>();
  if (!existing) return errorResponse('Product not found', 404);
  const body = await readJson<ProductInput & { aiDescription?: string | null; ingredients?: string | null; allergens?: string | null }>(req);
  const err = validateProductInput(body);
  if (err) return errorResponse(err);
  const b = body!;
  await rc.env.DB.prepare(
    'UPDATE products SET name = ?, collection = ?, description = ?, price = ?, is_active = ?, is_bestseller = ?, is_drop = ?, drop_starts_at = ?, drop_stock = ?, ai_description = ?, ingredients = ?, allergens = ? WHERE id = ?'
  )
    .bind(
      b.name!.trim(),
      b.collection,
      b.description!.trim(),
      b.price,
      b.isActive === false ? 0 : 1,
      b.isBestseller ? 1 : 0,
      ...dropBindings(b),
      b.aiDescription !== undefined ? b.aiDescription : existing.ai_description,
      b.ingredients !== undefined ? (b.ingredients?.trim() || null) : existing.ingredients,
      b.allergens !== undefined ? (b.allergens?.trim() || null) : existing.allergens,
      existing.id
    )
    .run();
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(existing.id).first<ProductRow>();
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'product_update', existing.id, b.name!.trim()));
  return json({ product: adminProduct(product!) });
});

export const adminDeleteProduct = requireAdmin(async (_req, rc) => {
  // Soft delete: order_items reference products, so keep the row.
  const result = await rc.env.DB.prepare('UPDATE products SET is_active = 0 WHERE id = ?').bind(rc.params.id).run();
  if (result.meta.changes === 0) return errorResponse('Product not found', 404);
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'product_delete', rc.params.id));
  return json({ ok: true });
});

// --- AI generation ---

export const adminGenerateDescription = requireAdmin(async (_req, rc) => {
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(rc.params.id).first<ProductRow>();
  if (!product) return errorResponse('Product not found', 404);
  const desc = await generateDescription(rc.env, product);
  await rc.env.DB.prepare('UPDATE products SET ai_description = ? WHERE id = ?').bind(desc, product.id).run();
  return json({ aiDescription: desc });
});

export const adminGenerateImage = requireAdmin(async (_req, rc) => {
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(rc.params.id).first<ProductRow>();
  if (!product) return errorResponse('Product not found', 404);
  // New image replaces the previous object at the same R2 key.
  const key = await generateProductImage(rc.env, product);
  await rc.env.DB.prepare('UPDATE products SET image_r2_key = ? WHERE id = ?').bind(key, product.id).run();
  // Cache-busting query param so admins immediately see the regenerated image.
  return json({ imageUrl: `/images/${key}?v=${Date.now()}` });
});

// --- Orders ---

export const adminListOrders = requireStaff(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all<OrderRow>();
  return json({ orders: await attachItems(rc, results) });
});

export const adminUpdateOrder = requireStaff(async (req, rc) => {
  const body = await readJson<{ status?: string }>(req);
  if (!body?.status || !ORDER_STATUSES.includes(body.status)) {
    return errorResponse(`status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }
  const result = await rc.env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(body.status, rc.params.id).run();
  if (result.meta.changes === 0) return errorResponse('Order not found', 404);
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'order_status', rc.params.id, body.status));
  return json({ ok: true });
});
