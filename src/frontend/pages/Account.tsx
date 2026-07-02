import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Order, Subscription } from '../lib/types';
import { formatPrice } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { PageSpinner } from '../components/Protected';

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-rx/20 text-rx',
  shipped: 'bg-gold/20 text-gold',
  delivered: 'bg-rx/20 text-rx',
  pending: 'bg-medical/10 text-medical/60',
  canceled: 'bg-red-500/20 text-red-300',
  refunded: 'bg-red-500/20 text-red-300',
  active: 'bg-rx/20 text-rx',
  past_due: 'bg-red-500/20 text-red-300',
};

export function Account() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null | undefined>(undefined);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    api.get<{ orders: Order[] }>('/api/account/orders').then((d) => setOrders(d.orders)).catch(() => setOrders([]));
    api
      .get<{ subscription: Subscription | null }>('/api/account/subscription')
      .then((d) => setSubscription(d.subscription))
      .catch(() => setSubscription(null));
  }, []);

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const { url } = await api.post<{ url: string }>('/api/account/portal');
      window.location.href = url;
    } catch {
      setPortalBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-5xl font-black">My Chart</h1>
      <p className="mt-2 text-xl text-medical/60">Patient: {user?.email}</p>

      {/* Subscription */}
      <section className="mt-10">
        <h2 className="text-3xl font-bold">Active Prescription</h2>
        {subscription === undefined ? (
          <PageSpinner />
        ) : subscription === null ? (
          <div className="rx-card mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-medical/70">No active subscription — your flavor levels may be dangerously low.</p>
            <Link to="/subscribe" className="btn-gold !py-2 !text-base">
              Start the Monthly Rx Box
            </Link>
          </div>
        ) : (
          <div className="rx-card mt-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-2xl font-black text-gold">{subscription.tierName}</p>
                <p className="mt-1 text-medical/70">
                  {subscription.itemsPerMonth} items/month ·{' '}
                  {subscription.priceMonthly ? `${formatPrice(subscription.priceMonthly)}/mo` : ''}
                </p>
                {subscription.nextBillingDate && (
                  <p className="mt-1 text-sm text-medical/50">
                    Next refill: {new Date(subscription.nextBillingDate).toLocaleDateString()}
                  </p>
                )}
              </div>
              <span className={`rounded-full px-4 py-1 text-sm font-bold uppercase ${STATUS_STYLES[subscription.status] ?? 'bg-medical/10'}`}>
                {subscription.status}
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/account/customize" className="btn-rx !py-2 !text-base">
                Customize My Box
              </Link>
              <button className="btn-outline !py-2 !text-base" onClick={openPortal} disabled={portalBusy}>
                {portalBusy ? 'Opening…' : 'Manage Billing (Stripe Portal)'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Orders */}
      <section className="mt-12">
        <h2 className="text-3xl font-bold">Order History</h2>
        {orders === null ? (
          <PageSpinner />
        ) : orders.length === 0 ? (
          <p className="mt-4 text-medical/60">No orders yet. The pharmacy awaits.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {orders.map((o) => (
              <div key={o.id} className="rx-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-medical/50">Order {o.id}</p>
                    <p className="text-sm text-medical/50">{new Date(o.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${STATUS_STYLES[o.status] ?? 'bg-medical/10'}`}>
                      {o.status}
                    </span>
                    <span className="text-xl font-extrabold text-gold">{formatPrice(o.total)}</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-medical/80">
                  {o.items.map((i) => (
                    <li key={`${o.id}-${i.productId}`}>
                      {i.quantity} × {i.slug ? <Link className="text-rx hover:underline" to={`/product/${i.slug}`}>{i.name}</Link> : i.name}{' '}
                      <span className="text-medical/50">({formatPrice(i.price)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
