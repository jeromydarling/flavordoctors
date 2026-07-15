import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { AdminNav } from './AdminNav';

interface Brand {
  name: string;
  tagline: string;
  voice: string;
  colors: { primary: string; accent: string; ink: string; bg: string };
  logoUrl: string | null;
  postalAddress: string;
  replyTo: string;
}

const COLOR_LABELS: Record<keyof Brand['colors'], string> = {
  primary: 'Primary (header)',
  accent: 'Accent (buttons)',
  ink: 'Ink (body text)',
  bg: 'Background',
};

export function AdminBrand() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<'marketing' | 'transactional'>('marketing');
  const [previewHtml, setPreviewHtml] = useState('');

  const loadPreview = useCallback(async (kind: string) => {
    const res = await fetch(`/api/admin/brand/preview?kind=${kind}`, { credentials: 'same-origin' });
    setPreviewHtml(await res.text());
  }, []);

  useEffect(() => {
    api.get<{ brand: Brand }>('/api/admin/brand').then((d) => setBrand(d.brand)).catch(() => setError('Failed to load brand'));
  }, []);
  useEffect(() => {
    loadPreview(previewKind);
  }, [previewKind, loadPreview]);

  const save = async () => {
    if (!brand) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await api.put('/api/admin/brand', brand);
      setMessage('Brand saved. Every email now renders with these settings.');
      await loadPreview(previewKind);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (!brand) return <div className="mx-auto max-w-7xl px-4 py-10"><AdminNav />{error ?? 'Loading…'}</div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <AdminNav />
      <h1 className="text-4xl font-black">Brand Studio</h1>
      <p className="mt-2 text-medical/70">
        One source of truth for identity: name, palette, and voice. Emails, exports, and AI-drafted copy all render from here.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rx-card">
            <label className="block text-sm font-bold" htmlFor="brand-name">Brand name</label>
            <input id="brand-name" className="input mt-1" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
            <label className="mt-4 block text-sm font-bold" htmlFor="brand-tagline">Tagline</label>
            <input id="brand-tagline" className="input mt-1" value={brand.tagline} onChange={(e) => setBrand({ ...brand, tagline: e.target.value })} />
            <label className="mt-4 block text-sm font-bold" htmlFor="brand-voice">Brand voice (steers all AI copy)</label>
            <textarea id="brand-voice" className="input mt-1 !text-sm" rows={4} value={brand.voice} onChange={(e) => setBrand({ ...brand, voice: e.target.value })} />
          </div>

          <div className="rx-card">
            <h2 className="font-bold">Palette</h2>
            <div className="mt-3 grid grid-cols-2 gap-4">
              {(Object.keys(COLOR_LABELS) as (keyof Brand['colors'])[]).map((k) => (
                <div key={k}>
                  <label className="block text-xs font-bold uppercase tracking-wide text-medical/60" htmlFor={`color-${k}`}>{COLOR_LABELS[k]}</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input id={`color-${k}`} type="color" value={brand.colors[k]} onChange={(e) => setBrand({ ...brand, colors: { ...brand.colors, [k]: e.target.value } })} className="h-9 w-12 cursor-pointer rounded border border-navy-lighter bg-transparent" />
                    <input aria-label={`${COLOR_LABELS[k]} hex`} className="input !py-1.5 !text-sm" value={brand.colors[k]} onChange={(e) => setBrand({ ...brand, colors: { ...brand.colors, [k]: e.target.value } })} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rx-card">
            <h2 className="font-bold">Email settings</h2>
            <label className="mt-3 block text-sm font-bold" htmlFor="brand-logo">Logo URL (optional — wordmark used when empty)</label>
            <input id="brand-logo" className="input mt-1" placeholder="https://flavordoctors.com/logo-email.png" value={brand.logoUrl ?? ''} onChange={(e) => setBrand({ ...brand, logoUrl: e.target.value || null })} />
            <label className="mt-4 block text-sm font-bold" htmlFor="brand-postal">Postal address (CAN-SPAM footer)</label>
            <input id="brand-postal" className="input mt-1" value={brand.postalAddress} onChange={(e) => setBrand({ ...brand, postalAddress: e.target.value })} />
            <label className="mt-4 block text-sm font-bold" htmlFor="brand-replyto">Reply-To address</label>
            <input id="brand-replyto" className="input mt-1" type="email" value={brand.replyTo} onChange={(e) => setBrand({ ...brand, replyTo: e.target.value })} />
          </div>

          <div className="flex items-center gap-4">
            <button className="btn-rx" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save brand'}</button>
            {message && <span className="text-sm text-rx">{message}</span>}
            {error && <span className="text-sm text-red-300">{error}</span>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Email preview</h2>
            <div className="flex gap-2 text-sm">
              <button className={`rounded-full px-3 py-1 font-bold ${previewKind === 'marketing' ? 'bg-rx text-navy' : 'bg-navy-light text-medical/70'}`} onClick={() => setPreviewKind('marketing')}>Marketing</button>
              <button className={`rounded-full px-3 py-1 font-bold ${previewKind === 'transactional' ? 'bg-rx text-navy' : 'bg-navy-light text-medical/70'}`} onClick={() => setPreviewKind('transactional')}>Transactional</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-medical/50">Save first to preview unsaved changes — the preview renders from stored settings.</p>
          <iframe title="Email preview" className="mt-3 h-[720px] w-full rounded-xl border-2 border-navy-lighter bg-white" srcDoc={previewHtml} />
        </div>
      </div>
    </div>
  );
}
