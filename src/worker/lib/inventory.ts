import type { Env } from '../types';

export interface StockLine {
  productId: string;
  qty: number;
}

/**
 * Consume stock FEFO (first-expiring lot first) for a shipped order or
 * subscription box. Idempotent per (kind, ref): a retried webhook is a no-op.
 * When lots run dry the shortfall is still recorded (lot_id NULL) so on-hand
 * goes negative and the oversell is visible instead of silently lost.
 */
export async function consumeStock(
  env: Env,
  kind: 'order' | 'subscription',
  ref: string,
  lines: StockLine[]
): Promise<void> {
  if (lines.length === 0) return;
  const seen = await env.DB.prepare('SELECT 1 FROM inventory_moves WHERE kind = ? AND ref = ? LIMIT 1')
    .bind(kind, ref)
    .first();
  if (seen) return;

  for (const line of lines) {
    if (line.qty <= 0) continue;
    // Only decrement SKUs that are actually being tracked (≥1 lot ever
    // received). Sales before tracking starts are reconciled by the first
    // cycle-count adjustment instead of flooding the board with negatives.
    const tracked = await env.DB.prepare('SELECT 1 FROM inventory_lots WHERE product_id = ? LIMIT 1')
      .bind(line.productId)
      .first();
    if (!tracked) continue;
    let need = line.qty;
    const { results: lots } = await env.DB.prepare(
      `SELECT id, remaining FROM inventory_lots
       WHERE product_id = ? AND remaining > 0
       ORDER BY (best_by IS NULL), best_by, id`
    )
      .bind(line.productId)
      .all<{ id: number; remaining: number }>();

    const statements = [];
    for (const lot of lots) {
      if (need <= 0) break;
      const take = Math.min(need, lot.remaining);
      need -= take;
      statements.push(
        env.DB.prepare('UPDATE inventory_lots SET remaining = remaining - ? WHERE id = ?').bind(take, lot.id),
        env.DB.prepare(
          'INSERT INTO inventory_moves (product_id, lot_id, delta, kind, ref) VALUES (?, ?, ?, ?, ?)'
        ).bind(line.productId, lot.id, -take, kind, ref)
      );
    }
    if (need > 0) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO inventory_moves (product_id, lot_id, delta, kind, ref) VALUES (?, NULL, ?, ?, ?)'
        ).bind(line.productId, -need, kind, ref)
      );
    }
    if (statements.length > 0) await env.DB.batch(statements);
  }
}

/**
 * Units committed to the NEXT box of every live (billing) subscription,
 * from each box's items_json. Paused subs don't bill, so they don't commit.
 */
export async function committedByProduct(env: Env): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    "SELECT items_json FROM subscriptions WHERE status IN ('active', 'past_due')"
  ).all<{ items_json: string }>();
  const map = new Map<string, number>();
  for (const row of results) {
    try {
      for (const id of JSON.parse(row.items_json) as string[]) {
        map.set(id, (map.get(id) ?? 0) + 1);
      }
    } catch {
      // Malformed items_json — skip that box rather than fail the report.
    }
  }
  return map;
}

export interface OnHandRow {
  id: string;
  name: string;
  reorder_point: number;
  on_hand: number | null; // NULL = never tracked (no moves yet)
}

/** On-hand per active product, from the movement ledger. */
export async function onHandByProduct(env: Env): Promise<OnHandRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.reorder_point, m.on_hand
     FROM products p
     LEFT JOIN (SELECT product_id, SUM(delta) AS on_hand FROM inventory_moves GROUP BY product_id) m
       ON m.product_id = p.id
     WHERE p.is_active = 1
     ORDER BY p.collection, p.name`
  ).all<OnHandRow>();
  return results;
}
