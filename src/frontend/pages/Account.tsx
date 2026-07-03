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

function AccountSettings() {
  const { logout } = useAuth();
  const [settings, setSettings] = useState<{ email: string; name: string; marketingConsent: boolean } | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [deletePw, setDeletePw] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ email: string; name: string; marketingConsent: boolean }>('/api/account/settings')
      .then((d) => {
        setSettings(d);
        setName(d.name);
      })
      .catch(() => {});
  }, []);

  if (!settings) return null;

  const saveProfile = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put('/api/account/settings', { name });
      setMsg('Saved.');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const toggleConsent = async () => {
    const next = !settings.marketingConsent;
    setSettings({ ...settings, marketingConsent: next });
    try {
      await api.put('/api/account/settings', { marketingConsent: next });
    } catch {
      setSettings({ ...settings, marketingConsent: !next });
    }
  };

  const changePassword = async () => {
    setBusy(true);
    setPwMsg(null);
    try {
      await api.post('/api/account/password', { currentPassword: pw.current, newPassword: pw.next });
      setPwMsg('Password updated.');
      setPw({ current: '', next: '' });
    } catch (e) {
      setPwMsg(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    setDeleteMsg(null);
    try {
      await api.post('/api/account/delete', { password: deletePw });
      await logout().catch(() => {});
      window.location.href = '/';
    } catch (e) {
      setDeleteMsg(e instanceof ApiError ? e.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <section className="mt-12">
      <h2 className="text-3xl font-bold">Account Settings</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rx-card !p-5">
          <h3 className="font-bold">Profile</h3>
          {msg && <p className="mt-2 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{msg}</p>}
          <label htmlFor="settings-name" className="mt-3 block text-sm font-bold">
            Preferred name
          </label>
          <input
            id="settings-name"
            className="input mt-1 !py-2"
            placeholder="How should we address you, Doc?"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn-rx mt-3 !px-4 !py-2 !text-sm" disabled={busy} onClick={saveProfile}>
            Save profile
          </button>
          <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-rx" checked={settings.marketingConsent} onChange={toggleConsent} />
            <span>
              <strong>Marketing emails</strong> — new treatments, specials, and the occasional prescription refill
              reminder.
            </span>
          </label>
        </div>

        <div className="rx-card !p-5">
          <h3 className="font-bold">Change password</h3>
          {pwMsg && <p className="mt-2 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{pwMsg}</p>}
          <label htmlFor="settings-current-pw" className="mt-3 block text-sm font-bold">
            Current password
          </label>
          <input
            id="settings-current-pw"
            type="password"
            autoComplete="current-password"
            className="input mt-1 !py-2"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
          <label htmlFor="settings-new-pw" className="mt-3 block text-sm font-bold">
            New password
          </label>
          <input
            id="settings-new-pw"
            type="password"
            autoComplete="new-password"
            minLength={8}
            className="input mt-1 !py-2"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
          <button
            className="btn-rx mt-3 !px-4 !py-2 !text-sm"
            disabled={busy || !pw.current || pw.next.length < 8}
            onClick={changePassword}
          >
            Update password
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border-2 border-red-400/30 p-5">
        <h3 className="font-bold text-red-300">Danger zone</h3>
        <p className="mt-1 text-sm text-medical/60">
          Deleting your account removes your profile, points, ratings, and marketing preferences permanently. Order
          records are kept for accounting. Cancel any active Rx Box first.
        </p>
        {!deleteOpen ? (
          <button className="mt-3 rounded-lg border border-red-400/40 px-4 py-2 text-sm font-bold text-red-300" onClick={() => setDeleteOpen(true)}>
            Delete my account…
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {deleteMsg && <p className="w-full rounded bg-red-500/20 p-2 text-sm text-red-300">{deleteMsg}</p>}
            <input
              type="password"
              aria-label="Confirm password to delete account"
              className="input !w-64 !py-2 !text-sm"
              placeholder="Confirm your password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
            />
            <button
              className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={busy || !deletePw}
              onClick={deleteAccount}
            >
              Permanently delete
            </button>
            <button className="btn-outline !px-4 !py-2 !text-sm" onClick={() => { setDeleteOpen(false); setDeletePw(''); setDeleteMsg(null); }}>
              Keep my account
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function SupportTickets() {
  const [tickets, setTickets] = useState<
    { id: string; subject: string; status: string; messages: { role: string; body: string; created_at: string }[] }[]
  >([]);
  useEffect(() => {
    api.get<{ tickets: typeof tickets }>('/api/account/tickets').then((d) => setTickets(d.tickets)).catch(() => {});
  }, []);
  if (tickets.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-3xl font-bold">Support Tickets</h2>
      <div className="mt-4 space-y-3">
        {tickets.map((t) => (
          <details key={t.id} className="rx-card !p-4">
            <summary className="cursor-pointer font-bold">
              <span className={t.status === 'open' ? 'text-gold' : 'text-medical/60'}>[{t.status}]</span> {t.subject}
            </summary>
            <div className="mt-3 space-y-2">
              {t.messages.map((m, i) => (
                <div key={i} className={`rounded-lg p-3 text-sm ${m.role === 'customer' ? 'bg-navy' : 'bg-rx/10'}`}>
                  <p className="mb-1 text-xs font-bold uppercase text-medical/60">{m.role === 'agent' ? 'Flavor Doctors' : m.role}</p>
                  <p className="whitespace-pre-wrap text-medical/90">{m.body}</p>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

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
  const [reviewFor, setReviewFor] = useState<{ productId: string; name: string; rating: number } | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

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
              <p className="mt-1 text-xs text-medical/60">
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
                  {subscription.priceMonthly
                    ? subscription.cadence === 'annual'
                      ? `${formatPrice(subscription.priceMonthly * 10)}/yr`
                      : `${formatPrice(subscription.priceMonthly)}/box`
                    : ''}
                </p>
                {subscription.nextBillingDate && (
                  <p className="mt-1 text-sm text-medical/60">
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

      {/* Review composer */}
      {reviewFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="w-full max-w-md rounded-xl border-2 border-navy-lighter bg-navy-light p-6">
            <h3 className="text-xl font-bold">Review: {reviewFor.name}</h3>
            <p className="mt-1 text-gold">{'★'.repeat(reviewFor.rating)}{'☆'.repeat(5 - reviewFor.rating)}</p>
            <textarea
              className="input mt-3"
              rows={4}
              placeholder="How did the treatment work? (10+ characters)"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            />
            {reviewMsg && <p className="mt-2 text-sm text-rx">{reviewMsg}</p>}
            <div className="mt-4 flex gap-3">
              <button
                className="btn-rx !py-2 !text-base"
                disabled={reviewText.trim().length < 10}
                onClick={async () => {
                  try {
                    await api.post(`/api/products/${reviewFor.productId}/review`, { rating: reviewFor.rating, body: reviewText.trim() });
                    setReviewMsg('Thanks, Doc! Your review is in for moderation.');
                    setTimeout(() => { setReviewFor(null); setReviewText(''); setReviewMsg(null); }, 1500);
                  } catch (e) {
                    setReviewMsg(e instanceof ApiError ? e.message : 'Could not submit');
                  }
                }}
              >
                Submit Review
              </button>
              <button className="btn-outline !py-2 !text-base" onClick={() => { setReviewFor(null); setReviewText(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support tickets */}
      <SupportTickets />

      {/* Orders + ratings */}
      <section className="mt-12">
        <h2 className="text-3xl font-bold">Order History</h2>
        <p className="mt-1 text-sm text-medical/60">Rate each treatment — it sharpens your future prescriptions.</p>
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
                    <p className="font-mono text-sm text-medical/60">Order {o.id}</p>
                    <p className="text-sm text-medical/60">{new Date(o.createdAt).toLocaleString()}</p>
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
                        <span className="text-medical/60">({formatPrice(i.price)})</span>
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
                        {(ratings[i.productId] ?? 0) > 0 && (
                          <button
                            className="ml-2 text-xs text-rx underline"
                            onClick={() => setReviewFor({ productId: i.productId, name: i.name, rating: ratings[i.productId] })}
                          >
                            + write review
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Settings */}
      <AccountSettings />
    </div>
  );
}
