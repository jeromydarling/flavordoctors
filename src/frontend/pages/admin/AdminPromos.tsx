import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface Promotion {
  id: string; name: string; code: string; percent_off: number; banner_text: string | null;
  starts_at: string; ends_at: string; is_active: number;
}
interface LandingPage {
  slug: string; title: string; headline: string; body: string; cta: string; offer: string | null;
  is_active: number; signups: number;
}

export function AdminPromos() {
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoForm, setPromoForm] = useState({ name: '', code: '', percentOff: '15', bannerText: '', startsAt: '', endsAt: '' });
  const [pageForm, setPageForm] = useState({ slug: '', title: '', headline: '', body: '', cta: 'Get Early Access', offer: '' });

  const load = () =>
    Promise.all([
      api.get<{ promotions: Promotion[] }>('/api/admin/marketing/promotions').then((d) => setPromotions(d.promotions)),
      api.get<{ pages: LandingPage[] }>('/api/admin/marketing/landing-pages').then((d) => setPages(d.pages)),
    ]);

  useEffect(() => {
    load().catch(() => setPromotions([]));
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
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

  if (promotions === null)
    return (<div className="mx-auto max-w-6xl px-4 py-12"><AdminNav /><PageSpinner /></div>);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      {message && <p className="mb-4 rounded bg-rx/10 p-3 font-semibold text-rx">{message}</p>}

      <h2 className="text-2xl font-bold">Specials & Sales</h2>
      <div className="rx-card mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <input className="input" placeholder="Sale name (e.g. Launch Week)" value={promoForm.name} onChange={(e) => setPromoForm({ ...promoForm, name: e.target.value })} />
          <input className="input" placeholder="Code (e.g. LAUNCHRX)" value={promoForm.code} onChange={(e) => setPromoForm({ ...promoForm, code: e.target.value.toUpperCase() })} />
          <input className="input" type="number" min="1" max="90" placeholder="% off" value={promoForm.percentOff} onChange={(e) => setPromoForm({ ...promoForm, percentOff: e.target.value })} />
        </div>
        <input className="input" placeholder="Banner text (optional — shown site-wide with countdown)" value={promoForm.bannerText} onChange={(e) => setPromoForm({ ...promoForm, bannerText: e.target.value })} />
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="mb-1 block text-xs font-bold">Starts (blank = now)</label>
            <input className="input" type="datetime-local" value={promoForm.startsAt} onChange={(e) => setPromoForm({ ...promoForm, startsAt: e.target.value })} /></div>
          <div><label className="mb-1 block text-xs font-bold">Ends</label>
            <input className="input" type="datetime-local" value={promoForm.endsAt} onChange={(e) => setPromoForm({ ...promoForm, endsAt: e.target.value })} /></div>
          <button className="btn-rx !py-2 !text-base" disabled={busy}
            onClick={() => run(() => api.post('/api/admin/marketing/promotions', {
              ...promoForm,
              percentOff: parseInt(promoForm.percentOff, 10),
              startsAt: promoForm.startsAt ? new Date(promoForm.startsAt).toISOString() : undefined,
              endsAt: promoForm.endsAt ? new Date(promoForm.endsAt).toISOString() : '',
            }), 'Promotion created — Stripe code is live.')}>
            Create Sale
          </button>
        </div>
        <p className="text-xs text-medical/60">Creates a real Stripe promo code. Shoppers enter it at checkout (bundles ≥3 items use the automatic 15% instead).</p>
      </div>

      <div className="mt-4 space-y-2">
        {promotions.map((p) => {
          const live = p.is_active === 1 && new Date(p.starts_at) <= new Date() && new Date(p.ends_at) > new Date();
          return (
            <div key={p.id} className="rx-card !p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold">{p.name} — <span className="text-gold">{p.code}</span> ({p.percent_off}% off)</p>
                <p className="text-sm text-medical/60">{new Date(p.starts_at).toLocaleString()} → {new Date(p.ends_at).toLocaleString()}
                  {live && <span className="ml-2 rounded-full bg-rx/20 px-2 py-0.5 text-xs font-bold text-rx">LIVE</span>}
                  {p.is_active === 0 && <span className="ml-2 text-xs">deactivated</span>}
                </p>
              </div>
              {p.is_active === 1 && (
                <button className="btn-outline !px-3 !py-1 !text-sm" disabled={busy}
                  onClick={() => run(() => api.delete(`/api/admin/marketing/promotions/${p.id}`), 'Promotion deactivated.')}>
                  Deactivate
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="mt-10 text-2xl font-bold">Landing Pages</h2>
      <div className="rx-card mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <input className="input" placeholder="Slug (e.g. early-access)" value={pageForm.slug} onChange={(e) => setPageForm({ ...pageForm, slug: e.target.value })} />
          <input className="input" placeholder="Page title" value={pageForm.title} onChange={(e) => setPageForm({ ...pageForm, title: e.target.value })} />
        </div>
        <input className="input" placeholder="Headline" value={pageForm.headline} onChange={(e) => setPageForm({ ...pageForm, headline: e.target.value })} />
        <textarea className="input" rows={2} placeholder="Body copy" value={pageForm.body} onChange={(e) => setPageForm({ ...pageForm, body: e.target.value })} />
        <div className="grid gap-3 md:grid-cols-2">
          <input className="input" placeholder="CTA button text" value={pageForm.cta} onChange={(e) => setPageForm({ ...pageForm, cta: e.target.value })} />
          <input className="input" placeholder="Offer chip (e.g. 'First 500: free shipping')" value={pageForm.offer} onChange={(e) => setPageForm({ ...pageForm, offer: e.target.value })} />
        </div>
        <button className="btn-rx !py-2 !text-base" disabled={busy}
          onClick={() => run(() => api.post('/api/admin/marketing/landing-pages', pageForm), 'Landing page published.')}>
          Publish Page
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {pages.map((p) => (
          <div key={p.slug} className="rx-card !p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold">
                <a href={`/lp/${p.slug}`} target="_blank" rel="noreferrer" className="text-gold hover:underline">/lp/{p.slug}</a> — {p.title}
              </p>
              <p className="text-sm text-medical/60">{p.signups} signups · {p.is_active ? 'active' : 'inactive'}</p>
            </div>
            <button className="btn-outline !px-3 !py-1 !text-sm" disabled={busy}
              onClick={() => run(() => api.post('/api/admin/marketing/landing-pages', { ...p, isActive: p.is_active !== 1, cta: p.cta, offer: p.offer ?? '' }), 'Page updated.')}>
              {p.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
