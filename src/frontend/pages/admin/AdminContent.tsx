import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { Product } from '../../lib/types';
import { AdminNav } from './AdminNav';

const CONTENT_TYPES = [
  { key: 'social-calendar', label: 'Weekly social calendar (TikTok 5x, IG 4x, Pinterest 3x)' },
  { key: 'captions', label: 'TikTok caption variants' },
  { key: 'subject-lines', label: 'Email subject lines' },
];

export function AdminContent() {
  const [type, setType] = useState('social-calendar');
  const [brief, setBrief] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [imgProduct, setImgProduct] = useState('');
  const [scene, setScene] = useState('drizzled over a smash burger on a rustic wooden board');
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ products: Product[] }>('/api/admin/products').then((d) => {
      setProducts(d.products);
      if (d.products[0]) setImgProduct(d.products[0].id);
    }).catch(() => {});
  }, []);

  const generate = async () => {
    setBusy('text');
    setError(null);
    try {
      const d = await api.post<{ output: string }>('/api/admin/content/generate', { type, brief });
      setOutput(d.output);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Generation failed');
    } finally {
      setBusy(null);
    }
  };

  const generateImage = async () => {
    setBusy('image');
    setError(null);
    try {
      const d = await api.post<{ imageUrl: string }>('/api/admin/content/lifestyle-image', { productId: imgProduct, scene });
      setImageUrl(d.imageUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Generation failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      {error && <p className="mb-4 rounded bg-red-500/20 p-3 text-red-300">{error}</p>}

      <h2 className="text-2xl font-bold">AI Content Studio</h2>
      <div className="rx-card mt-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)}>
            {CONTENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input className="input flex-1" placeholder="Direction (optional): product focus, occasion, promo…" value={brief} onChange={(e) => setBrief(e.target.value)} />
          <button className="btn-rx !py-2 !text-base" disabled={busy !== null} onClick={generate}>
            {busy === 'text' ? 'Generating…' : '✦ Generate'}
          </button>
        </div>
        {output && (
          <div>
            <textarea className="input font-mono !text-sm" rows={16} readOnly value={output} />
            <button className="btn-outline mt-2 !px-4 !py-1 !text-sm" onClick={() => navigator.clipboard.writeText(output)}>
              📋 Copy to clipboard
            </button>
          </div>
        )}
      </div>

      <h2 className="mt-10 text-2xl font-bold">Lifestyle Imagery (Flux)</h2>
      <div className="rx-card mt-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <select className="input !w-64" value={imgProduct} onChange={(e) => setImgProduct(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input flex-1" placeholder="Scene" value={scene} onChange={(e) => setScene(e.target.value)} />
          <button className="btn-gold !py-2 !text-base" disabled={busy !== null || !imgProduct} onClick={generateImage}>
            {busy === 'image' ? 'Rendering…' : '📸 Generate'}
          </button>
        </div>
        {imageUrl && (
          <div>
            <img src={imageUrl} alt="Generated lifestyle" className="max-h-96 rounded-xl border-2 border-navy-lighter" />
            <p className="mt-2 text-sm text-medical/60">Saved to R2 — right-click to download, or use the URL: <code className="rounded bg-navy-light px-1">{imageUrl}</code></p>
          </div>
        )}
      </div>

      <h2 className="mt-10 text-2xl font-bold">B2B Kit</h2>
      <div className="rx-card mt-4 flex flex-wrap gap-3">
        <a className="btn-rx !py-2 !text-base" href="/api/admin/b2b/sell-sheet" target="_blank" rel="noreferrer">🖨 Sell Sheet (full catalog)</a>
        {['mayo', 'butter', 'burger-sauce', 'toppers', 'seasoning'].map((c) => (
          <a key={c} className="btn-outline !py-2 !text-sm" href={`/api/admin/b2b/sell-sheet?collection=${c}`} target="_blank" rel="noreferrer">{c}</a>
        ))}
        <a className="btn-gold !py-2 !text-base" href="/api/admin/b2b/rangeme.csv">⬇ RangeMe CSV (all SKUs)</a>
      </div>
      <p className="mt-2 text-sm text-medical/60">
        Sell sheets open print-ready (Save as PDF). RangeMe CSV includes MSRP, wholesale (50% keystone), and specs for all active SKUs.
      </p>
    </div>
  );
}
