import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const TIER_CARDS = [
  { name: 'Resident', first: '25%', recurring: '10%', note: 'Where everyone starts' },
  { name: 'Attending', first: '28%', recurring: '12%', note: 'At $1,000 referred revenue + quarterly free product' },
  { name: 'Chief of Medicine', first: '30%', recurring: '15%', note: 'At $5,000 + early access to new drops' },
];

export function Affiliates() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null | 'none'>('none');
  const [form, setForm] = useState({ name: '', handle: '', link1: '', link2: '', audience: '', pitch: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<{ affiliate: { status: string } | null }>('/api/affiliates/me')
      .then((d) => setStatus(d.affiliate?.status ?? 'none'))
      .catch(() => {});
  }, [user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ status: string }>('/api/affiliates/apply', {
        name: form.name,
        handle: form.handle || undefined,
        links: [form.link1, form.link2].filter(Boolean),
        audience: form.audience,
        pitch: form.pitch,
      });
      setStatus(d.status);
      if (d.status === 'approved') navigate('/affiliates/portal');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <p className="text-sm font-bold uppercase tracking-widest text-gold">The House Call Network</p>
      <h1 className="mt-2 text-5xl font-black">Prescribe flavor. Get paid.</h1>
      <p className="mt-4 max-w-2xl text-xl text-medical/80">
        Love what we make? Join the network, get your own discount code and link, and earn real money every time your
        audience fills a prescription — including a cut of subscription renewals for a full year.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TIER_CARDS.map((t) => (
          <div key={t.name} className="rx-card !p-5">
            <p className="font-heading text-xl font-black text-gold">{t.name}</p>
            <p className="mt-2 text-3xl font-black text-rx">{t.first}</p>
            <p className="text-sm text-medical/60">on first orders</p>
            <p className="mt-1 font-bold">{t.recurring} <span className="font-normal text-medical/60">on renewals (12 mo)</span></p>
            <p className="mt-2 text-xs text-medical/60">{t.note}</p>
          </div>
        ))}
      </div>

      <ul className="mt-8 space-y-2 text-medical/80">
        <li>💊 <strong>Your own code</strong> gives your audience 15% off — spoken codes count, no link required.</li>
        <li>📚 <strong>A living resource library</strong>: product one-sheets, hooks, ready-to-post copy with your code baked in.</li>
        <li>💸 <strong>Monthly payouts</strong> over $25 — cash to your bank via Stripe, or store credit at 1.25×.</li>
        <li>🤝 <strong>Micro-creators welcome</strong>: a few hundred engaged followers beats 50k passive ones.</li>
      </ul>

      <div className="mt-10 rounded-xl border-2 border-navy-lighter p-6">
        {!user ? (
          <div className="text-center">
            <h2 className="text-2xl font-bold">Ready to join?</h2>
            <p className="mt-2 text-medical/70">Create a free account (or sign in) to apply — most applications are approved instantly.</p>
            <Link to="/login" className="btn-rx mt-4 inline-block">Sign in to apply</Link>
          </div>
        ) : status === 'approved' ? (
          <div className="text-center">
            <p className="text-lg font-bold text-rx">You're in! 🩺</p>
            <Link to="/affiliates/portal" className="btn-gold mt-3 inline-block">Open your Affiliate Portal</Link>
          </div>
        ) : status === 'pending' ? (
          <p className="text-center text-lg">
            <strong>Application received.</strong> It's in review — you'll get an email either way, usually within a day.
          </p>
        ) : status === 'paused' || status === 'banned' ? (
          <p className="text-center text-medical/70">Your affiliate account is currently inactive. Contact support with questions.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-2xl font-bold">Apply for credentials</h2>
            {status === 'rejected' && (
              <p className="rounded bg-gold/10 p-2 text-sm text-gold">Your previous application wasn't approved — feel free to reapply as your channel grows.</p>
            )}
            {error && <p className="rounded bg-red-500/20 p-2 text-sm text-red-300">{error}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="aff-name" className="block text-sm font-bold">Your name</label>
                <input id="aff-name" className="input mt-1 !py-2" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aff-handle" className="block text-sm font-bold">Primary handle <span className="font-normal text-medical/60">(optional)</span></label>
                <input id="aff-handle" className="input mt-1 !py-2" placeholder="@chefmike" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aff-link1" className="block text-sm font-bold">Where you post</label>
                <input id="aff-link1" className="input mt-1 !py-2" required type="url" placeholder="https://tiktok.com/@you" value={form.link1} onChange={(e) => setForm({ ...form, link1: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aff-link2" className="block text-sm font-bold">Second link <span className="font-normal text-medical/60">(optional)</span></label>
                <input id="aff-link2" className="input mt-1 !py-2" type="url" placeholder="https://instagram.com/you" value={form.link2} onChange={(e) => setForm({ ...form, link2: e.target.value })} />
              </div>
            </div>
            <div>
              <label htmlFor="aff-audience" className="block text-sm font-bold">Who's your audience?</label>
              <textarea id="aff-audience" className="input mt-1 !text-sm" rows={2} required placeholder="Home cooks who meal prep on Sundays; ~2k followers, mostly parents…" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
            </div>
            <div>
              <label htmlFor="aff-pitch" className="block text-sm font-bold">How would you prescribe Flavor Doctors to them?</label>
              <textarea id="aff-pitch" className="input mt-1 !text-sm" rows={3} required placeholder="Weekly 'doctor the dinner' series where I fix a boring staple with one product…" value={form.pitch} onChange={(e) => setForm({ ...form, pitch: e.target.value })} />
            </div>
            <button type="submit" className="btn-rx" disabled={busy}>
              {busy ? 'Reviewing…' : 'Submit application'}
            </button>
            <p className="text-xs text-medical/60">
              By applying you agree to disclose the partnership on every post (#ad), never make real health claims, and never post codes to coupon sites.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
