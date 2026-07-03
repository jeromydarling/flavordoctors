import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Drop } from '../lib/types';
import { formatPrice } from '../lib/types';
import { useCart } from '../context/CartContext';
import { ProductImage } from '../components/ProductImage';
import { PageSpinner } from '../components/Protected';

const STATE_BADGES: Record<Drop['state'], { label: string; cls: string }> = {
  upcoming: { label: 'Enrolling soon', cls: 'bg-gold/20 text-gold' },
  'early-access': { label: 'Subscriber early access', cls: 'bg-rx/20 text-rx' },
  live: { label: 'Now enrolling', cls: 'bg-rx text-navy' },
  'sold-out': { label: 'Trial complete', cls: 'bg-medical/10 text-medical/60' },
};

export function Trials() {
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const cart = useCart();

  useEffect(() => {
    api.get<{ drops: Drop[] }>('/api/drops').then((d) => setDrops(d.drops)).catch(() => setDrops([]));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <p className="text-center text-sm font-extrabold uppercase tracking-widest text-gold">Experimental Compounds</p>
      <h1 className="mt-3 text-center text-5xl font-black md:text-6xl">Clinical Trials</h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-xl text-medical/70">
        Limited-batch flavors that may never be released again. Rx Box subscribers get 48-hour early access to
        every trial. When a batch is gone, the trial is over.
      </p>

      {drops === null ? (
        <PageSpinner />
      ) : drops.length === 0 ? (
        <div className="mt-12 rounded-xl border-2 border-dashed border-navy-lighter p-12 text-center">
          <p className="text-2xl font-bold text-medical/60">No trials currently enrolling.</p>
          <p className="mt-2 text-medical/60">
            New experimental compounds drop quarterly.{' '}
            <Link to="/subscribe" className="text-rx underline">Subscribers hear first</Link>.
          </p>
        </div>
      ) : (
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {drops.map((d) => {
            const badge = STATE_BADGES[d.state];
            return (
              <div key={d.product.id} className="overflow-hidden rounded-xl border-2 border-navy-lighter bg-navy-light">
                <div className="relative">
                  <ProductImage product={d.product} className="h-56 w-full" />
                  <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-extrabold uppercase ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="p-5">
                  <h2 className="font-heading text-2xl font-bold">{d.product.name}</h2>
                  <p className="mt-1 text-medical/70">{d.product.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xl font-extrabold text-gold">{formatPrice(d.product.price)}</span>
                    {d.stock !== null && d.state !== 'sold-out' && (
                      <span className="text-sm font-bold text-gold">{d.stock} doses left</span>
                    )}
                  </div>
                  {d.startsAt && (d.state === 'upcoming' || d.state === 'early-access') && (
                    <p className="mt-2 text-sm text-medical/60">
                      Public enrollment: {new Date(d.startsAt).toLocaleString()}
                      {d.earlyAccessAt && (
                        <> · Subscribers: {new Date(d.earlyAccessAt).toLocaleString()}</>
                      )}
                    </p>
                  )}
                  <div className="mt-4">
                    {d.canBuy ? (
                      <button className="btn-rx w-full !py-2 !text-base" onClick={() => cart.add(d.product)}>
                        + Enroll (Add to Cart)
                      </button>
                    ) : d.state === 'sold-out' ? (
                      <button className="btn-outline w-full !py-2 !text-base" disabled>
                        Batch exhausted
                      </button>
                    ) : (
                      <WaitlistForm productId={d.product.id} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WaitlistForm({ productId }: { productId: string }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/drops/${productId}/waitlist`, { email });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not enroll');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <p className="rounded-lg bg-rx/10 p-3 text-center font-bold text-rx">Enrolled — we'll email you when the trial opens. 🧪</p>;
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="email"
        required
        placeholder="you@example.com"
        className="input !py-2"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" className="btn-gold shrink-0 !px-4 !py-2 !text-base" disabled={busy}>
        {busy ? '…' : 'Join Waitlist'}
      </button>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  );
}
