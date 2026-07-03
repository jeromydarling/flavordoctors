import { Fragment, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface Lot {
  lotCode: string;
  remaining: number;
  quantity: number;
  bestBy: string | null;
  poRef: string | null;
  receivedAt: string;
}
interface InvRow {
  id: string;
  name: string;
  tracked: boolean;
  onHand: number;
  committed: number;
  available: number;
  reorderPoint: number;
  lots: Lot[];
}
interface Move {
  product_id: string;
  delta: number;
  kind: string;
  ref: string | null;
  created_at: string;
}

export function AdminInventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receive, setReceive] = useState({ productId: '', lotCode: '', quantity: '', bestBy: '', poRef: '' });
  const [adjust, setAdjust] = useState({ productId: '', delta: '', reason: '' });

  const load = () =>
    api.get<{ products: InvRow[]; recentMoves: Move[] }>('/api/admin/inventory').then((d) => {
      setRows(d.products);
      setMoves(d.recentMoves);
    });
  useEffect(() => {
    load().catch(() => setRows([]));
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const badge = (r: InvRow) => {
    if (!r.tracked) return <span className="rounded-full bg-navy-lighter px-2 py-0.5 text-xs font-bold text-medical/60">not tracked</span>;
    if (r.available < 0) return <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">oversold</span>;
    if (r.available <= r.reorderPoint) return <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-bold text-gold">low — reorder</span>;
    return <span className="rounded-full bg-rx/20 px-2 py-0.5 text-xs font-bold text-rx">ok</span>;
  };

  const names = new Map((rows ?? []).map((r) => [r.id, r.name]));

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <h2 className="text-2xl font-bold">Inventory</h2>
      <p className="mt-1 text-sm text-medical/60">
        On-hand comes from the movement ledger. Committed = units reserved for the next box of every live
        subscription. Lots ship first-expiring-first, so lot traceability stays honest.
      </p>

      {message && <p className="mt-4 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}

      {isAdmin && rows && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {/* Receive a delivery */}
          <div className="rounded-xl border-2 border-navy-lighter p-4">
            <h3 className="font-bold">Receive a delivery</h3>
            <div className="mt-3 space-y-2">
              <select id="recv-product" aria-label="Product to receive" className="input !py-2 !text-sm" value={receive.productId} onChange={(e) => setReceive({ ...receive, productId: e.target.value })}>
                <option value="">Product…</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input aria-label="Lot code" className="input !py-2 !text-sm" placeholder="Lot code (from the label)" value={receive.lotCode} onChange={(e) => setReceive({ ...receive, lotCode: e.target.value })} />
                <input aria-label="Quantity received" className="input !w-28 !py-2 !text-sm" type="number" min={1} placeholder="Qty" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <input aria-label="Best-by date" className="input !py-2 !text-sm" type="date" value={receive.bestBy} onChange={(e) => setReceive({ ...receive, bestBy: e.target.value })} />
                <input aria-label="PO reference" className="input !py-2 !text-sm" placeholder="PO ref (optional)" value={receive.poRef} onChange={(e) => setReceive({ ...receive, poRef: e.target.value })} />
              </div>
              <button
                className="btn-rx !px-4 !py-2 !text-sm"
                disabled={busy || !receive.productId || !receive.lotCode.trim() || !receive.quantity}
                onClick={() =>
                  act(
                    () =>
                      api
                        .post('/api/admin/inventory/receive', {
                          productId: receive.productId,
                          lotCode: receive.lotCode.trim(),
                          quantity: parseInt(receive.quantity, 10),
                          bestBy: receive.bestBy || undefined,
                          poRef: receive.poRef.trim() || undefined,
                        })
                        .then(() => setReceive({ productId: '', lotCode: '', quantity: '', bestBy: '', poRef: '' })),
                    'Delivery received.'
                  )
                }
              >
                Receive stock
              </button>
            </div>
          </div>

          {/* Adjust */}
          <div className="rounded-xl border-2 border-navy-lighter p-4">
            <h3 className="font-bold">Adjust (cycle count, damage, samples)</h3>
            <div className="mt-3 space-y-2">
              <select id="adj-product" aria-label="Product to adjust" className="input !py-2 !text-sm" value={adjust.productId} onChange={(e) => setAdjust({ ...adjust, productId: e.target.value })}>
                <option value="">Product…</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input aria-label="Adjustment delta" className="input !w-28 !py-2 !text-sm" type="number" placeholder="±Qty" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value })} />
                <input aria-label="Adjustment reason" className="input !py-2 !text-sm" placeholder="Reason (required)" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
              </div>
              <button
                className="btn-gold !px-4 !py-2 !text-sm"
                disabled={busy || !adjust.productId || !adjust.delta || !adjust.reason.trim()}
                onClick={() =>
                  act(
                    () =>
                      api
                        .post('/api/admin/inventory/adjust', {
                          productId: adjust.productId,
                          delta: parseInt(adjust.delta, 10),
                          reason: adjust.reason.trim(),
                        })
                        .then(() => setAdjust({ productId: '', delta: '', reason: '' })),
                    'Adjustment recorded.'
                  )
                }
              >
                Apply adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {rows === null ? (
        <PageSpinner />
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border-2 border-navy-lighter">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-navy-light uppercase tracking-wide text-medical/60">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3 text-right">On hand</th>
                <th className="p-3 text-right">Committed</th>
                <th className="p-3 text-right">Available</th>
                <th className="p-3 text-right">Reorder at</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-lighter">
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-navy-light/50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="p-3 font-bold text-gold">{r.name}</td>
                    <td className="p-3 text-right">{r.tracked ? r.onHand : '—'}</td>
                    <td className="p-3 text-right">{r.committed}</td>
                    <td className="p-3 text-right font-bold">{r.tracked ? r.available : '—'}</td>
                    <td className="p-3 text-right">{r.reorderPoint}</td>
                    <td className="p-3">{badge(r)}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={6} className="bg-navy p-3">
                        {r.lots.length === 0 ? (
                          <p className="text-sm text-medical/60">No open lots.</p>
                        ) : (
                          <ul className="space-y-1 text-sm text-medical/80">
                            {r.lots.map((l) => (
                              <li key={l.lotCode + l.receivedAt}>
                                <span className="font-mono text-gold">{l.lotCode}</span> — {l.remaining}/{l.quantity} left
                                {l.bestBy && <> · best by {l.bestBy}</>}
                                {l.poRef && <> · PO {l.poRef}</>}
                                <span className="text-medical/50"> · received {new Date(l.receivedAt + 'Z').toLocaleDateString()}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-10 text-xl font-bold">Recent movements</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border-2 border-navy-lighter">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-navy-light uppercase tracking-wide text-medical/60">
            <tr>
              <th className="p-3">When</th>
              <th className="p-3">Product</th>
              <th className="p-3 text-right">Δ</th>
              <th className="p-3">Kind</th>
              <th className="p-3">Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-lighter">
            {moves.map((m, i) => (
              <tr key={i}>
                <td className="p-3 whitespace-nowrap text-medical/60">{new Date(m.created_at + 'Z').toLocaleString()}</td>
                <td className="p-3">{names.get(m.product_id) ?? m.product_id}</td>
                <td className={`p-3 text-right font-bold ${m.delta < 0 ? 'text-red-300' : 'text-rx'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td className="p-3 font-mono text-xs">{m.kind}</td>
                <td className="p-3 text-medical/60">{m.ref ?? '—'}</td>
              </tr>
            ))}
            {moves.length === 0 && (
              <tr>
                <td className="p-6 text-center text-medical/60" colSpan={5}>
                  No movements yet — receive your first delivery above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
