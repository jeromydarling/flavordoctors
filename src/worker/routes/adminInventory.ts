import { json, errorResponse, readJson } from '../lib/util';
import { requireAdmin, requireStaff } from '../lib/auth';
import { audit } from '../lib/audit';
import { committedByProduct, onHandByProduct } from '../lib/inventory';

interface LotRow {
  id: number;
  product_id: string;
  lot_code: string;
  quantity: number;
  remaining: number;
  best_by: string | null;
  po_ref: string | null;
  received_at: string;
}

/**
 * Inventory board: on-hand (ledger), committed (next boxes of live subs),
 * available, reorder point, and open lots per active product. Staff can view;
 * receiving and adjustments are admin-only.
 */
export const getInventory = requireStaff(async (_req, rc) => {
  const [rows, committed, lots, moves] = await Promise.all([
    onHandByProduct(rc.env),
    committedByProduct(rc.env),
    rc.env.DB.prepare(
      'SELECT id, product_id, lot_code, quantity, remaining, best_by, po_ref, received_at FROM inventory_lots WHERE remaining > 0 ORDER BY (best_by IS NULL), best_by, id'
    ).all<LotRow>(),
    rc.env.DB.prepare(
      'SELECT product_id, delta, kind, ref, created_at FROM inventory_moves ORDER BY id DESC LIMIT 50'
    ).all(),
  ]);
  const lotsByProduct = new Map<string, LotRow[]>();
  for (const lot of lots.results) {
    const list = lotsByProduct.get(lot.product_id) ?? [];
    list.push(lot);
    lotsByProduct.set(lot.product_id, list);
  }
  const products = rows.map((r) => {
    const c = committed.get(r.id) ?? 0;
    return {
      id: r.id,
      name: r.name,
      tracked: r.on_hand !== null,
      onHand: r.on_hand ?? 0,
      committed: c,
      available: (r.on_hand ?? 0) - c,
      reorderPoint: r.reorder_point,
      lots: (lotsByProduct.get(r.id) ?? []).map((l) => ({
        lotCode: l.lot_code,
        remaining: l.remaining,
        quantity: l.quantity,
        bestBy: l.best_by,
        poRef: l.po_ref,
        receivedAt: l.received_at,
      })),
    };
  });
  return json({ products, recentMoves: moves.results });
});

/** Record a co-packer delivery: creates a lot and a +receive ledger move. */
export const receiveStock = requireAdmin(async (req, rc) => {
  const b = await readJson<{
    productId?: string;
    lotCode?: string;
    quantity?: number;
    bestBy?: string;
    poRef?: string;
    note?: string;
  }>(req);
  const lotCode = b?.lotCode?.trim();
  if (!b?.productId || !lotCode) return errorResponse('productId and lotCode required');
  if (!Number.isInteger(b.quantity) || b.quantity! <= 0 || b.quantity! > 100000) {
    return errorResponse('quantity must be a positive integer');
  }
  const bestBy = b.bestBy?.trim() ? b.bestBy.trim().slice(0, 10) : null;
  if (bestBy && Number.isNaN(Date.parse(bestBy))) return errorResponse('bestBy must be a date (YYYY-MM-DD)');
  const product = await rc.env.DB.prepare('SELECT id, name FROM products WHERE id = ?')
    .bind(b.productId)
    .first<{ id: string; name: string }>();
  if (!product) return errorResponse('Product not found', 404);

  const result = await rc.env.DB.prepare(
    'INSERT INTO inventory_lots (product_id, lot_code, quantity, remaining, best_by, po_ref, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(product.id, lotCode, b.quantity, b.quantity, bestBy, b.poRef?.trim() || null, b.note?.trim() || null)
    .run();
  await rc.env.DB.prepare(
    "INSERT INTO inventory_moves (product_id, lot_id, delta, kind, ref) VALUES (?, ?, ?, 'receive', ?)"
  )
    .bind(product.id, result.meta.last_row_id, b.quantity, lotCode)
    .run();
  rc.ctx.waitUntil(
    audit(rc.env, rc.user!.email, 'stock_receive', product.id, `${product.name}: +${b.quantity} lot ${lotCode}${bestBy ? ` (best by ${bestBy})` : ''}`)
  );
  return json({ ok: true }, 201);
});

/** Manual correction (cycle count, damage, samples). Negative pulls FEFO from lots. */
export const adjustStock = requireAdmin(async (req, rc) => {
  const b = await readJson<{ productId?: string; delta?: number; reason?: string }>(req);
  const reason = b?.reason?.trim();
  if (!b?.productId || !reason) return errorResponse('productId and reason required');
  if (!Number.isInteger(b.delta) || b.delta === 0 || Math.abs(b.delta!) > 100000) {
    return errorResponse('delta must be a non-zero integer');
  }
  const product = await rc.env.DB.prepare('SELECT id, name FROM products WHERE id = ?')
    .bind(b.productId)
    .first<{ id: string; name: string }>();
  if (!product) return errorResponse('Product not found', 404);

  if (b.delta! < 0) {
    // Pull the shrinkage from the oldest lots so traceability stays honest.
    let need = -b.delta!;
    const { results: lots } = await rc.env.DB.prepare(
      'SELECT id, remaining FROM inventory_lots WHERE product_id = ? AND remaining > 0 ORDER BY (best_by IS NULL), best_by, id'
    )
      .bind(product.id)
      .all<{ id: number; remaining: number }>();
    const statements = [];
    for (const lot of lots) {
      if (need <= 0) break;
      const take = Math.min(need, lot.remaining);
      need -= take;
      statements.push(
        rc.env.DB.prepare('UPDATE inventory_lots SET remaining = remaining - ? WHERE id = ?').bind(take, lot.id),
        rc.env.DB.prepare(
          "INSERT INTO inventory_moves (product_id, lot_id, delta, kind, ref) VALUES (?, ?, ?, 'adjust', ?)"
        ).bind(product.id, lot.id, -take, reason.slice(0, 100))
      );
    }
    if (need > 0) {
      statements.push(
        rc.env.DB.prepare(
          "INSERT INTO inventory_moves (product_id, lot_id, delta, kind, ref) VALUES (?, NULL, ?, 'adjust', ?)"
        ).bind(product.id, -need, reason.slice(0, 100))
      );
    }
    if (statements.length > 0) await rc.env.DB.batch(statements);
  } else {
    await rc.env.DB.prepare(
      "INSERT INTO inventory_moves (product_id, lot_id, delta, kind, ref) VALUES (?, NULL, ?, 'adjust', ?)"
    )
      .bind(product.id, b.delta, reason.slice(0, 100))
      .run();
  }
  rc.ctx.waitUntil(
    audit(rc.env, rc.user!.email, 'stock_adjust', product.id, `${product.name}: ${b.delta! > 0 ? '+' : ''}${b.delta} (${reason})`)
  );
  return json({ ok: true });
});

/** Per-SKU reorder threshold used by the nightly low-stock alert. */
export const setReorderPoint = requireAdmin(async (req, rc) => {
  const b = await readJson<{ value?: number }>(req);
  if (!Number.isInteger(b?.value) || b!.value! < 0) return errorResponse('value must be a non-negative integer');
  const result = await rc.env.DB.prepare('UPDATE products SET reorder_point = ? WHERE id = ?')
    .bind(b!.value, rc.params.id)
    .run();
  if (result.meta.changes === 0) return errorResponse('Product not found', 404);
  return json({ ok: true });
});
