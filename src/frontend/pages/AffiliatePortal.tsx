import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatPrice } from '../lib/types';
import { PageSpinner } from '../components/Protected';

interface Affiliate {
  status: string;
  name?: string;
  link?: string;
  code?: string;
  discountPct?: number;
  tier?: string;
  tierName?: string;
  rates?: { firstPct: number; recurringPct: number };
  nextTier?: { name: string; revenueNeeded: number } | null;
  probation?: boolean;
  payoutMethod?: string;
  connected?: boolean;
  payoutFloor?: number;
  creditMultiplier?: number;
  stats?: { clicks30d: number; conversions: number; attributedRevenue: number; pending: number; cleared: number; paidOut: number };
}
interface Library {
  playbooks: { slug: string; title: string; body: string[] }[];
  productKits: {
    id: string;
    name: string;
    slug: string;
    collection: string;
    price: number;
    description: string;
    doctorsNotes: string | null;
    imageUrl: string | null;
    isBestseller: boolean;
    quotes: { rating: number; body: string }[];
    treatmentPlans: { slug: string; title: string }[];
    enrichment: { hooks: string[]; angles: string[]; dos: string[]; donts: string[] } | null;
  }[];
  promoKits: { name: string; percentOff: number; endsAt: string; copy: { post: string; story: string; email: string } | null }[];
  whatsNew: { kind: string; title: string; updatedAt: string }[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-outline !px-2 !py-0.5 !text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable — text is visible to copy by hand.
        }
      }}
    >
      {copied ? '✓' : '📋 copy'}
    </button>
  );
}

export function AffiliatePortal() {
  const [aff, setAff] = useState<Affiliate | null | undefined>(undefined);
  const [library, setLibrary] = useState<Library | null>(null);
  const [openKit, setOpenKit] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ affiliate: Affiliate | null }>('/api/affiliates/me')
      .then((d) => {
        setAff(d.affiliate);
        if (d.affiliate?.status === 'approved') {
          api.get<Library>('/api/affiliates/library').then(setLibrary).catch(() => {});
        }
      })
      .catch(() => setAff(null));
  }, []);

  // Every snippet ships copy-paste ready with this affiliate's code and link.
  const personalize = useMemo(
    () => (s: string) => s.replace(/\{\{CODE\}\}/g, aff?.code ?? 'YOURCODE').replace(/\{\{LINK\}\}/g, aff?.link ?? ''),
    [aff]
  );

  if (aff === undefined) return <PageSpinner />;
  if (!aff || aff.status !== 'approved') {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-4xl font-black">Credentials pending 🩺</h1>
        <p className="mt-4 text-medical/70">
          {aff?.status === 'pending'
            ? 'Your application is in review — the portal unlocks the moment you are approved.'
            : 'The portal is for approved House Call Network members.'}
        </p>
        <Link to="/affiliates" className="btn-rx mt-6 inline-block">About the program</Link>
      </div>
    );
  }

  const s = aff.stats!;
  const connectBank = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.post<{ url: string }>('/api/affiliates/connect');
      window.location.href = url;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Could not start onboarding');
      setBusy(false);
    }
  };
  const setMethod = async (method: string) => {
    setMessage(null);
    try {
      await api.put('/api/affiliates/payout-method', { method });
      setAff({ ...aff, payoutMethod: method });
      setMessage(method === 'credit' ? 'Payouts switch to store credit at 1.25×.' : 'Payouts switch to cash via Stripe.');
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <p className="text-sm font-bold uppercase tracking-widest text-gold">House Call Network</p>
      <h1 className="text-4xl font-black">Dr. {aff.name} <span className="text-rx">·</span> {aff.tierName}</h1>
      {aff.probation && (
        <p className="mt-1 text-sm text-medical/60">Probation month: first payout capped at $200 and clears in 45 days — lifts automatically after your first payout.</p>
      )}
      {message && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}

      {/* Prescription pad */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border-2 border-gold/50 p-4">
        <div>
          <p className="text-xs font-bold uppercase text-medical/60">Your code ({aff.discountPct}% off for them)</p>
          <p className="font-mono text-2xl font-black tracking-widest text-gold">{aff.code}</p>
        </div>
        <CopyButton text={aff.code!} />
        <div className="ml-4">
          <p className="text-xs font-bold uppercase text-medical/60">Your link</p>
          <p className="font-mono text-sm text-rx">{aff.link}</p>
        </div>
        <CopyButton text={aff.link!} />
      </div>

      {/* Vitals */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Clicks (30d)', value: String(s.clicks30d) },
          { label: 'Orders driven', value: String(s.conversions) },
          { label: 'Pending earnings', value: formatPrice(s.pending) },
          { label: 'Cleared (payable)', value: formatPrice(s.cleared) },
        ].map((t) => (
          <div key={t.label} className="rx-card !p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-medical/60">{t.label}</p>
            <p className="mt-1 text-3xl font-black text-gold">{t.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-medical/60">
        Rates: {aff.rates!.firstPct}% first orders · {aff.rates!.recurringPct}% renewals (12 mo) · {formatPrice(s.paidOut)} paid out lifetime
        {aff.nextTier && <> · {formatPrice(aff.nextTier.revenueNeeded)} more revenue to {aff.nextTier.name}</>}
      </p>

      {/* Payouts */}
      <div className="mt-6 rounded-xl border-2 border-navy-lighter p-4">
        <h2 className="font-bold">Payouts <span className="text-sm font-normal text-medical/60">(monthly, over {formatPrice(aff.payoutFloor!)})</span></h2>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="payout" className="accent-rx" checked={aff.payoutMethod === 'credit'} onChange={() => setMethod('credit')} />
            Store credit at <strong className="text-gold">1.25×</strong> (points, instant)
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="payout" className="accent-rx" checked={aff.payoutMethod === 'connect'} onChange={() => setMethod('connect')} />
            Cash to my bank (Stripe)
          </label>
          {aff.payoutMethod === 'connect' && !aff.connected && (
            <button className="btn-gold !px-3 !py-1.5 !text-sm" disabled={busy} onClick={connectBank}>
              Connect my bank →
            </button>
          )}
          {aff.payoutMethod === 'connect' && aff.connected && <span className="font-bold text-rx">✓ bank connected</span>}
        </div>
      </div>

      {/* ---------- The Library ---------- */}
      <h2 className="mt-12 text-3xl font-black">The Medical Library 📚</h2>
      <p className="mt-1 text-medical/60">
        Everything below updates itself — new products, price changes, and sales land here automatically, with your code
        already baked into every snippet.
      </p>

      {library === null ? (
        <PageSpinner />
      ) : (
        <>
          {library.whatsNew.length > 0 && (
            <div className="mt-4 rounded-lg border border-gold/40 p-3 text-sm">
              <strong className="text-gold">New this month:</strong>{' '}
              {library.whatsNew.map((w) => w.title).join(' · ')}
            </div>
          )}

          {/* Active sales */}
          {library.promoKits.length > 0 && (
            <section className="mt-6">
              <h3 className="text-xl font-bold">🚨 Active sales — post these now</h3>
              {library.promoKits.map((p) => (
                <div key={p.name} className="rx-card mt-3 !p-4">
                  <p className="font-bold text-gold">{p.name} — {p.percentOff}% off, ends {new Date(p.endsAt).toLocaleDateString()}</p>
                  {p.copy && (
                    <div className="mt-2 space-y-2 text-sm">
                      {(['post', 'story', 'email'] as const).map((k) => (
                        <div key={k} className="flex items-start gap-2">
                          <span className="w-12 shrink-0 text-xs font-bold uppercase text-medical/60">{k}</span>
                          <p className="flex-1 rounded bg-navy p-2">{personalize(p.copy![k])}</p>
                          <CopyButton text={personalize(p.copy![k])} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Playbooks */}
          <section className="mt-8">
            <h3 className="text-xl font-bold">Playbooks</h3>
            <div className="mt-3 space-y-2">
              {library.playbooks.map((pb) => (
                <details key={pb.slug} className="rx-card !p-4">
                  <summary className="cursor-pointer font-bold">{pb.title}</summary>
                  <ul className="mt-3 space-y-2 text-sm text-medical/80">
                    {pb.body.map((line, i) => (
                      <li key={i} className="flex gap-2"><span className="text-rx">✚</span> {personalize(line)}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>

          {/* Product kits */}
          <section className="mt-8">
            <h3 className="text-xl font-bold">Product one-sheets ({library.productKits.length})</h3>
            <div className="mt-3 space-y-2">
              {library.productKits.map((kit) => (
                <div key={kit.id} className="rounded-xl border-2 border-navy-lighter">
                  <button
                    className="flex w-full flex-wrap items-center gap-3 p-4 text-left"
                    onClick={() => setOpenKit(openKit === kit.id ? null : kit.id)}
                  >
                    <span className="font-bold text-gold">{kit.name}</span>
                    {kit.isBestseller && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-bold text-gold">bestseller</span>}
                    <span className="text-sm text-medical/60">{formatPrice(kit.price)} · {kit.collection}</span>
                    <span className="ml-auto text-medical/50">{openKit === kit.id ? '▾' : '▸'}</span>
                  </button>
                  {openKit === kit.id && (
                    <div className="border-t border-navy-lighter p-4 text-sm">
                      <p className="text-medical/80">{kit.description}</p>
                      {kit.doctorsNotes && <p className="mt-2 whitespace-pre-line rounded bg-navy p-2 text-medical/70">℞ {kit.doctorsNotes}</p>}
                      {kit.imageUrl && (
                        <p className="mt-2">
                          <a className="text-rx underline" href={kit.imageUrl} target="_blank" rel="noreferrer">Download product image →</a>
                        </p>
                      )}
                      {kit.enrichment && (
                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="font-bold text-gold">Hooks</p>
                            {kit.enrichment.hooks.map((h, i) => (
                              <div key={i} className="mt-1 flex items-start gap-2">
                                <p className="flex-1 rounded bg-navy p-2">{personalize(h)}</p>
                                <CopyButton text={personalize(h)} />
                              </div>
                            ))}
                          </div>
                          <div>
                            <p className="font-bold text-gold">Content angles</p>
                            <ul className="mt-1 space-y-1 text-medical/80">
                              {kit.enrichment.angles.map((a, i) => <li key={i}>• {personalize(a)}</li>)}
                            </ul>
                          </div>
                          <div>
                            <p className="font-bold text-rx">Do</p>
                            <ul className="mt-1 space-y-1 text-medical/80">
                              {kit.enrichment.dos.slice(0, 4).map((d, i) => <li key={i}>✓ {personalize(d)}</li>)}
                            </ul>
                          </div>
                          <div>
                            <p className="font-bold text-red-300">Don't</p>
                            <ul className="mt-1 space-y-1 text-medical/80">
                              {kit.enrichment.donts.slice(0, 3).map((d, i) => <li key={i}>✕ {personalize(d)}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}
                      {kit.quotes.length > 0 && (
                        <div className="mt-3">
                          <p className="font-bold">Real reviews to quote</p>
                          {kit.quotes.map((q, i) => (
                            <p key={i} className="mt-1 text-medical/70">“{q.body}” — {q.rating}★ verified buyer</p>
                          ))}
                        </div>
                      )}
                      {kit.treatmentPlans.length > 0 && (
                        <p className="mt-3 text-medical/70">
                          Recipes to share:{' '}
                          {kit.treatmentPlans.map((tp) => (
                            <a key={tp.slug} className="mr-2 text-rx underline" href={`/treatment-plans/${tp.slug}`} target="_blank" rel="noreferrer">{tp.title}</a>
                          ))}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
