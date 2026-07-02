import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Order } from '../../lib/types';
import { formatPrice } from '../../lib/types';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'canceled', 'refunded'];

export function AdminOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = () => api.get<{ orders: Order[] }>('/api/admin/orders').then((d) => setOrders(d.orders));

  useEffect(() => {
    load().catch(() => setOrders([]));
  }, []);

  const updateStatus = async (id: string, status: string) => {
    setSavingId(id);
    try {
      await api.put(`/api/admin/orders/${id}`, { status });
      await load();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <h2 className="text-2xl font-bold">Orders {orders ? `(${orders.length})` : ''}</h2>
      {orders === null ? (
        <PageSpinner />
      ) : orders.length === 0 ? (
        <p className="mt-6 text-medical/60">No orders yet. Waiting room is empty.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {orders.map((o) => (
            <div key={o.id} className="rx-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-medical/50">{o.id}</p>
                  <p className="font-bold">{o.email ?? 'No email on file'}</p>
                  <p className="text-sm text-medical/50">{new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xl font-extrabold text-gold">{formatPrice(o.total)}</span>
                  <select
                    className="input !w-auto !py-2"
                    value={o.status}
                    disabled={savingId === o.id}
                    onChange={(e) => updateStatus(o.id, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <ul className="mt-3 text-sm text-medical/70">
                {o.items.map((i) => (
                  <li key={`${o.id}-${i.productId}`}>
                    {i.quantity} × {i.name} ({formatPrice(i.price)})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
