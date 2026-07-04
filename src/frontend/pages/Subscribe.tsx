import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { affRef } from '../lib/affiliate';
import { TIERS, CADENCES, formatPrice } from '../lib/types';
import { useAuth } from '../context/AuthContext';

// Average à-la-carte item price used to show honest savings math.
const AVG_ITEM_PRICE = 1112;

export function Subscribe() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [cadence, setCadence] = useState<string>('monthly');
  const [error, setError] = useState<string | null>(null);

  const subscribe = async (tier: string) => {
    if (!user) {
      navigate('/login', { state: { from: '/subscribe' } });
      return;
    }
    setBusyTier(tier);
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>('/api/subscribe', {
        tier,
        cadence,
        ...(affRef() ? { affiliateRef: affRef() } : {}),
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start checkout');
      setBusyTier(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="text-center">
        <p className="inline-block rounded-full border-2 border-gold px-4 py-1 text-sm font-extrabold uppercase tracking-widest text-gold">
          Recurring Prescription
        </p>
        <h1 className="mt-4 text-5xl font-black md:text-6xl">
          The <span className="text-gold">Rx Box</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-xl text-medical/70">
          The only box where <span className="font-bold text-medical">you choose every item</span> — across all five
          departments. Free shipping, always. Swap your picks any time, or trust the doctor's best-sellers.
        </p>
        <p className="mx-auto mt-4 inline-block rounded-lg bg-rx/10 px-5 py-2 text-lg font-bold text-rx">
          🩺 First box 20% off — automatically applied at checkout
        </p>
      </div>

      {/* Cadence */}
      <div className="mt-10 flex justify-center gap-2">
        {CADENCES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCadence(c.key)}
            className={`rounded-full border-2 px-6 py-2 font-bold transition-colors ${
              cadence === c.key ? 'border-rx bg-rx text-navy' : 'border-navy-lighter text-medical/70 hover:border-rx'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-sm text-medical/60">
        {cadence === 'bimonthly'
          ? 'Every-2-months: same box, half the pace — perfect if your pantry runs deep.'
          : cadence === 'annual'
            ? 'Annual prepay: 12 monthly boxes, billed once — you pay for 10.'
            : 'Monthly: the standard course of treatment.'}
      </p>

      {error && <p className="mx-auto mt-8 max-w-lg rounded bg-red-500/20 p-3 text-center text-red-300">{error}</p>}

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {TIERS.map((tier, i) => {
          const savings = Math.round((1 - tier.price / (tier.items * AVG_ITEM_PRICE)) * 100);
          return (
            <div
              key={tier.key}
              className={`rx-card relative flex flex-col text-center ${i === 1 ? 'border-gold shadow-xl shadow-gold/10 md:-translate-y-3' : ''}`}
            >
              {i === 1 && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gold px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-navy">
                  Doctor Recommended
                </span>
              )}
              {i === 2 && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-rx px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-navy">
                  Best Value — lowest per item
                </span>
              )}
              <h2 className="mt-2 font-heading text-3xl font-black">{tier.name}</h2>
              {cadence === 'annual' ? (
                <>
                  <p className="mt-4 text-5xl font-black text-rx">
                    {formatPrice(tier.price * 10)}
                    <span className="text-lg font-semibold text-medical/60">/yr</span>
                  </p>
                  <p className="mt-1 text-sm font-bold text-gold">12 boxes — 2 months free</p>
                </>
              ) : (
                <p className="mt-4 text-5xl font-black text-rx">
                  {formatPrice(tier.price)}
                  <span className="text-lg font-semibold text-medical/60">/box</span>
                </p>
              )}
              <p className="mt-2 text-lg font-bold text-gold">{tier.items} items per box</p>
              <p className="mt-1 text-sm font-bold text-rx">
                Save ~{cadence === 'annual' ? Math.round((1 - (tier.price * 10) / (12 * tier.items * AVG_ITEM_PRICE)) * 100) : savings}% vs à la
                carte · {formatPrice(Math.round((cadence === 'annual' ? tier.price * 10 / 12 : tier.price) / tier.items))}/item
              </p>
              <p className="mt-4 flex-1 text-medical/70">{tier.blurb}</p>
              <ul className="mt-6 space-y-2 text-left text-sm text-medical/80">
                <li>✓ Choose any {tier.items} products, swap every box</li>
                <li>✓ 48-hour early access to Clinical Trial drops</li>
                <li>✓ Skip or pause anytime — one click, no phone calls</li>
                <li>✓ Free shipping on every box</li>
                <li>✓ Earn 1 loyalty point per $1</li>
              </ul>
              <button
                className={`${i === 1 ? 'btn-gold' : 'btn-rx'} mt-8 w-full`}
                disabled={busyTier !== null}
                onClick={() => subscribe(tier.key)}
              >
                {busyTier === tier.key ? 'Preparing checkout…' : `Prescribe ${tier.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-10 text-center text-sm text-medical/60">
        Billed via Stripe per box. Skip, pause, downshift to every-2-months, or cancel anytime — no cancellation
        maze, we promise. {user ? '' : 'You’ll be asked to sign in before checkout.'}
      </p>
    </div>
  );
}
