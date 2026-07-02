import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { TIERS, formatPrice } from '../lib/types';
import { useAuth } from '../context/AuthContext';

export function Subscribe() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subscribe = async (tier: string) => {
    if (!user) {
      navigate('/login', { state: { from: '/subscribe' } });
      return;
    }
    setBusyTier(tier);
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>('/api/subscribe', { tier });
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
          The Monthly <span className="text-gold">Rx Box</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-xl text-medical/70">
          A monthly delivery of doctored delights. Pick your dosage, customize your treatment plan any time,
          or let the doctor choose our best-sellers for you.
        </p>
      </div>

      {error && <p className="mx-auto mt-8 max-w-lg rounded bg-red-500/20 p-3 text-center text-red-300">{error}</p>}

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {TIERS.map((tier, i) => (
          <div
            key={tier.key}
            className={`rx-card relative flex flex-col text-center ${i === 1 ? 'border-gold shadow-xl shadow-gold/10 md:-translate-y-3' : ''}`}
          >
            {i === 1 && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gold px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-navy">
                Doctor Recommended
              </span>
            )}
            <h2 className="mt-2 font-heading text-3xl font-black">{tier.name}</h2>
            <p className="mt-4 text-5xl font-black text-rx">
              {formatPrice(tier.price)}
              <span className="text-lg font-semibold text-medical/50">/mo</span>
            </p>
            <p className="mt-2 text-lg font-bold text-gold">{tier.items} items every month</p>
            <p className="mt-4 flex-1 text-medical/70">{tier.blurb}</p>
            <ul className="mt-6 space-y-2 text-left text-sm text-medical/80">
              <li>✓ Choose any {tier.items} products, swap monthly</li>
              <li>✓ Default box = our best-sellers</li>
              <li>✓ Cancel or pause anytime via billing portal</li>
              <li>✓ Free shipping on every box</li>
            </ul>
            <button
              className={`${i === 1 ? 'btn-gold' : 'btn-rx'} mt-8 w-full`}
              disabled={busyTier !== null}
              onClick={() => subscribe(tier.key)}
            >
              {busyTier === tier.key ? 'Preparing checkout…' : `Prescribe ${tier.name}`}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-medical/50">
        Billed monthly via Stripe. {user ? '' : 'You’ll be asked to sign in before checkout.'}
      </p>
    </div>
  );
}
