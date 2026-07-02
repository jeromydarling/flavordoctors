import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { FlavorProfile, LoyaltyInfo, Order, Subscription } from '../lib/types';
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
  paused: 'bg-gold/20 text-gold',
  past_due: 'bg-red-500/20 text-red-300',
};

const TIER_EMOJI: Record<string, string> = {
  patient: '🩹',
  resident: '🩺',
  attending: '⚕️',
  chief: '🏆',
};

export function Account() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null | undefined>(undefined);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [profile, setProfile] = useState<FlavorProfile | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [portalBusy, setPortalBusy] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subMessage, setSubMessage] = useState<string | null>(null);
  const [pausePick, setPausePick] = useState(false);

  const loadSubscription = () =>
    api
      .get<{ subscription: Subscription | null }>('/api/account/subscription')
      .then((d) => setSubscription(d.subscription))
      .catch(() => setSubscription(null));

  useEffect(() => {
    api.get<{ orders: Order[] }>('/api/account/orders').then((d) => setOrders(d.orders)).catch(() => setOrders([]));
    api.get<{ ratings: Record<string, number> }>('/api/account/ratings').then((d) => setRatings(d.ratings)).catch(() => {});
    api.get<LoyaltyInfo>('/api/account/loyalty').then(setLoyalty).catch(() => {});
    api.get<{ profile: FlavorProfile | null }>('/api/account/profile').then((d) => setProfile(d.profile)).catch(() => {});
    loadSubscription();
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

  const subAction = async (path: string, body?: unknown, message?: string) => {
    setSubBusy(true);
    setSubMessage(null);
    setPausePick(false);
    try {
      await api.post(path, body);
      if (message) setSubMessage(message);
      await loadSubscription();
    } catch (e) {
      setSubMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setSubBusy(false);
    }
  };

  const rate = async (productId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [productId]: rating }));
    try {
      await api.post(`/api/products/${productId}/rate`, { rating });
    } catch {
      // Non-fatal; the optimistic state stands corrected on next load.
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-5xl font-black">My Chart</h1>
          <p className="mt-2 text-xl text-medical/60">Patient: {user?.email}</p>
        </div>
        {loyalty && (
          <div className="rounded-xl border-2 border-gold bg-navy-light px-5 py-3 text-center">
            <p className="text-2xl">{TIER_EMOJI[loyalty.tier.key] ?? '🩹'}</p>
            <p className="font-heading text-lg font-black text-gold">{loyalty.tier.name}</p>
            <p className="text-sm text-medical/60">{loyalty.points} pts</p>
            {loyalty.nextTier && (
              <p className="mt-1 text-xs text-medical/50">
                {loyalty.nextTier.pointsNeeded} pts to {loyalty.nextTier.name}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Diagnosis */}
      {profile?.condition ? (
        <section className="mt-8 rounded-xl border-2 border-navy-lighter bg-navy-light p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-rx">Diagnosis on file</p>
              <p className="mt-1 font-heading text-2xl font-bold text-gold">{profile.condition}</p>
              <p className="mt-1 text-sm text-medical/60">
                Prescribed: {profile.prescription.map((p) => p.name).join(', ')}
              </p>
            </div>
            <Link to="/intake-exam" className="btn-outline !py-2 !text-sm">
              Retake the Intake Exam
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-8 rounded-xl border-2 border-dashed border-navy-lighter p-5 text-center">
          <p className="text-medical/70">
            No diagnosis on file.{' '}
            <Link to="/intake-exam" className="font-bold text-rx underline">Take the Intake Exam</Link>{' '}
            for a personalized prescription.
          </p>
        </section>
      )}

      {/* Subscription */}
      <section className="mt-10">
        <h2 className="text-3xl font-bold">Active Prescription</h2>
        {subscription === undefined ? (
          <PageSpinner />
        ) : subscription === null ? (
          <div className="rx-card mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-medical/70">No active subscription — your flavor levels may be dangerously low.</p>
            <Link to="/subscribe" className="btn-gold !py-2 !text-base">
              Start the Rx Box (20% off your first)
            </Link>
          </div>
        ) : (
          <div className="rx-card mt-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-2xl font-black text-gold">{subscription.tierName}</p>
                <p className="mt-1 text-medical/70">
                  {subscription.itemsPerMonth} items · {subscription.cadenceLabel.toLowerCase()} ·{' '}
                  {subscription.priceMonthly ? `${formatPrice(subscription.priceMonthly)}/box` : ''}
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

            {subMessage && <p className="mt-4 rounded bg-rx/10 p-3 text-sm font-semibold text-rx">{subMessage}</p>}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/account/customize" className="btn-rx !py-2 !text-base">
                Customize My Box
              </Link>
              {['active', 'past_due'].includes(subscription.status) && (
                <>
                  <button
                    className="btn-outline !py-2 !text-base"
                    disabled={subBusy}
                    onClick={() => subAction('/api/account/subscription/skip', undefined, 'Next box skipped — no charge next cycle. Your subscription resumes automatically.')}
                  >
                    Skip Next Box
                  </button>
                  <button className="btn-outline !py-2 !text-base" disabled={subBusy} onClick={() => setPausePick((v) => !v)}>
                    Pause…
                  </button>
                </>
              )}
              {subscription.status === 'paused' && (
                <button
                  className="btn-gold !py-2 !text-base"
                  disabled={subBusy}
                  onClick={() => subAction('/api/account/subscription/resume', undefined, 'Welcome back — your prescription is active again.')}
                >
                  Resume Now
                </button>
              )}
              <button className="btn-outline !py-2 !text-base" onClick={openPortal} disabled={portalBusy}>
                {portalBusy ? 'Opening…' : 'Manage Billing'}
              </button>
            </div>
            {pausePick && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-navy-lighter p-4">
                <span className="font-bold">Pause for:</span>
                {[1, 2, 3].map((m) => (
                  <button
                    key={m}
                    className="btn-outline !px-4 !py-1 !text-sm"
                    disabled={subBusy}
                    onClick={() => subAction('/api/account/subscription/pause', { months: m }, `Paused for ${m} month${m > 1 ? 's' : ''}. We'll be here when you're hungry again.`)}
                  >
                    {m} month{m > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Orders + ratings */}
      <section className="mt-12">
        <h2 className="text-3xl font-bold">Order History</h2>
        <p className="mt-1 text-sm text-medical/50">Rate each treatment — it sharpens your future prescriptions.</p>
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
                <ul className="mt-3 space-y-2 text-medical/80">
                  {o.items.map((i) => (
                    <li key={`${o.id}-${i.productId}`} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {i.quantity} × {i.slug ? <Link className="text-rx hover:underline" to={`/product/${i.slug}`}>{i.name}</Link> : i.name}{' '}
                        <span className="text-medical/50">({formatPrice(i.price)})</span>
                      </span>
                      <span className="flex items-center gap-1" aria-label={`Rate ${i.name}`}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => rate(i.productId, star)}
                            className={`text-lg leading-none transition-colors ${
                              (ratings[i.productId] ?? 0) >= star ? 'text-gold' : 'text-medical/25 hover:text-gold/60'
                            }`}
                            title={`${star} star${star > 1 ? 's' : ''}`}
                          >
                            ★
                          </button>
                        ))}
                      </span>
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
