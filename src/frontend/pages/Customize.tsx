import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product, Subscription } from '../lib/types';
import { COLLECTIONS } from '../lib/types';
import { PageSpinner } from '../components/Protected';
import { ProductImage } from '../components/ProductImage';

export function Customize() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [searchParams] = useSearchParams();
  const welcome = searchParams.get('welcome') === '1';

  useEffect(() => {
    api.get<{ products: Product[] }>('/api/products').then((d) => setProducts(d.products)).catch(() => setProducts([]));
    api
      .get<{ subscription: Subscription | null }>('/api/account/subscription')
      .then((d) => {
        setSubscription(d.subscription);
        setSelected(d.subscription?.items ?? []);
      })
      .catch(() => setSubscription(null));
  }, []);

  const limit = subscription?.itemsPerMonth ?? 0;

  const toggle = (id: string) => {
    setMessage(null);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < limit ? [...prev, id] : prev
    );
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.put('/api/account/subscription/items', { items: selected });
      setMessage({ kind: 'ok', text: 'Treatment plan updated! Your next box will contain these items.' });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not save your box' });
    } finally {
      setSaving(false);
    }
  };

  const byCollection = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products ?? []) {
      map.set(p.collection, [...(map.get(p.collection) ?? []), p]);
    }
    return map;
  }, [products]);

  if (subscription === undefined || products === null) return <PageSpinner />;

  if (subscription === null || !['active', 'past_due'].includes(subscription.status)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-4xl font-black">No active prescription</h1>
        <p className="mt-4 text-xl text-medical/70">
          {welcome
            ? 'Your subscription is being confirmed — this usually takes a few seconds. Refresh shortly, or check back from your account page.'
            : 'You need an active Monthly Rx Box to customize a treatment plan.'}
        </p>
        <Link to={welcome ? '/account' : '/subscribe'} className="btn-gold mt-8">
          {welcome ? 'Go to My Chart' : 'Choose a plan'}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      {welcome && (
        <div className="mb-8 rounded-xl border-2 border-rx bg-rx/10 p-6 text-center">
          <h2 className="text-3xl font-black text-rx">Prescription filled! 🩺</h2>
          <p className="mt-2 text-medical/80">
            Welcome to the {subscription.tierName}. Pick your {limit} items below — or keep the doctor's
            default best-sellers.
          </p>
        </div>
      )}
      <h1 className="text-5xl font-black">Customize Your Rx Box</h1>
      <p className="mt-2 text-xl text-medical/70">
        {subscription.tierName}: choose exactly {limit} treatments for next month's box.
      </p>

      {/* Sticky selection status */}
      <div className="sticky top-20 z-30 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-navy-lighter bg-navy p-4">
        <p className="text-lg font-bold">
          Selected: <span className={selected.length === limit ? 'text-rx' : 'text-gold'}>{selected.length}</span> / {limit}
        </p>
        {message && (
          <p className={`text-sm font-semibold ${message.kind === 'ok' ? 'text-rx' : 'text-red-300'}`}>{message.text}</p>
        )}
        <button className="btn-rx !py-2 !text-base" disabled={selected.length !== limit || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save Treatment Plan'}
        </button>
      </div>

      {COLLECTIONS.map((c) => {
        const items = byCollection.get(c.key) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={c.key} className="mt-10">
            <h2 className="text-3xl font-bold text-gold">{c.label}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((p) => {
                const isSelected = selected.includes(p.id);
                const disabled = !isSelected && selected.length >= limit;
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    disabled={disabled}
                    className={`relative overflow-hidden rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-rx shadow-lg shadow-rx/20'
                        : disabled
                          ? 'border-navy-lighter opacity-40'
                          : 'border-navy-lighter hover:border-medical/40'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-rx font-black text-navy">
                        ✓
                      </span>
                    )}
                    <ProductImage product={p} className="h-28 w-full" />
                    <div className="p-3">
                      <p className="font-bold leading-tight">{p.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
