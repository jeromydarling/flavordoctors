import type { OrderRow, RequestContext } from '../types';
import { json } from '../lib/util';
import { requireAuth } from '../lib/auth';

interface OrderItemJoin {
  order_id: string;
  product_id: string;
  quantity: number;
  price_at_purchase: number;
  name: string | null;
  slug: string | null;
}

export const listMyOrders = requireAuth(async (_req, rc) => {
  const { results: orders } = await rc.env.DB.prepare(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  )
    .bind(rc.user!.id)
    .all<OrderRow>();
  return json({ orders: await attachItems(rc, orders) });
});

export async function attachItems(rc: RequestContext, orders: OrderRow[]) {
  if (orders.length === 0) return [];
  // SQLite caps bound variables (~100) — chunk the IN() lookups so large
  // order lists (admin view is 200) don't blow the limit.
  const byOrder = new Map<string, OrderItemJoin[]>();
  for (let i = 0; i < orders.length; i += 80) {
    const chunk = orders.slice(i, i + 80);
    const placeholders = chunk.map(() => '?').join(',');
    const { results: items } = await rc.env.DB.prepare(
      `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price_at_purchase, p.name, p.slug
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id IN (${placeholders})`
    )
      .bind(...chunk.map((o) => o.id))
      .all<OrderItemJoin>();
    for (const item of items) {
      const list = byOrder.get(item.order_id) ?? [];
      list.push(item);
      byOrder.set(item.order_id, list);
    }
  }

  return orders.map((o) => ({
    id: o.id,
    email: o.email,
    total: o.total,
    status: o.status,
    createdAt: o.created_at,
    items: (byOrder.get(o.id) ?? []).map((i) => ({
      productId: i.product_id,
      name: i.name ?? 'Discontinued product',
      slug: i.slug,
      quantity: i.quantity,
      price: i.price_at_purchase,
    })),
  }));
}
