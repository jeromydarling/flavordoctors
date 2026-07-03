import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { Product } from '../../lib/types';
import { AdminNav } from './AdminNav';

const CONTENT_TYPES = [
  { key: 'social-calendar', label: 'Weekly social calendar (TikTok 5x, IG 4x, Pinterest 3x)' },
  { key: 'captions', label: 'TikTok caption variants' },
  { key: 'subject-lines', label: 'Email subject lines' },
];

interface RecipeRow {
  id: string;
  slug: string;
  title: string;
  is_published: number;
  product_name: string;
  created_at: string;
}

function RecipeStudio({ products }: { products: Product[] }) {
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [productId, setProductId] = useState('');
  const [dish, setDish] = useState('');
  const [draft, setDraft] = useState<{ title: string; intro: string; bodyHtml: string; productId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => api.get<{ recipes: RecipeRow[] }>('/api/admin/recipes').then((d) => setRecipes(d.recipes)).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!productId && products[0]) setProductId(products[0].id);
  }, [products, productId]);

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.post<{ draft: typeof draft }>('/api/admin/recipes/generate', { productId, dish });
      setDraft(d.draft);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const save = async (publish: boolean) => {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.post<{ slug: string }>('/api/admin/recipes', { ...draft, publish });
      setMessage(publish ? `Published at /treatment-plans/${d.slug}` : 'Saved as draft.');
      setDraft(null);
      setDish('');
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (r: RecipeRow) => {
    await api.post(`/api/admin/recipes/${r.id}/publish`, { publish: r.is_published !== 1 }).catch(() => {});
    await load();
  };

  return (
    <>
      <h2 className="mt-10 text-2xl font-bold">Treatment Plans (SEO Recipe Hub)</h2>
      <p className="mt-1 text-sm text-medical/60">
        AI-drafted, server-rendered recipe pages with Recipe schema — each one links back to its product and lands in the
        sitemap. Published plans appear at <a className="text-rx underline" href="/treatment-plans" target="_blank" rel="noreferrer">/treatment-plans</a>.
      </p>
      <div className="rx-card mt-4 space-y-3">
        {message && <p className="rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}
        <div className="flex flex-wrap gap-3">
          <select aria-label="Recipe product" className="input !w-64" value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            className="input flex-1"
            placeholder="Dish to cure (e.g. weeknight chicken thighs, smash burgers)…"
            value={dish}
            onChange={(e) => setDish(e.target.value)}
          />
          <button className="btn-rx !py-2 !text-base" disabled={busy || !productId} onClick={generate}>
            {busy ? 'Writing…' : '🩺 Draft plan'}
          </button>
        </div>
        {draft && (
          <div className="space-y-2 rounded-lg border border-navy-lighter p-3">
            <input aria-label="Recipe title" className="input !py-2 font-bold" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea aria-label="Recipe intro" className="input !text-sm" rows={2} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
            <textarea aria-label="Recipe body HTML" className="input font-mono !text-xs" rows={10} value={draft.bodyHtml} onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-rx !px-4 !py-2 !text-sm" disabled={busy} onClick={() => save(true)}>
                Publish now
              </button>
              <button className="btn-outline !px-4 !py-2 !text-sm" disabled={busy} onClick={() => save(false)}>
                Save draft
              </button>
            </div>
          </div>
        )}
        {recipes.length > 0 && (
          <ul className="divide-y divide-navy-lighter text-sm">
            {recipes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{r.title}</strong> <span className="text-medical/60">· Rx {r.product_name}</span>
                  {r.is_published === 1 ? (
                    <a className="ml-2 text-rx underline" href={`/treatment-plans/${r.slug}`} target="_blank" rel="noreferrer">live</a>
                  ) : (
                    <span className="ml-2 text-medical/50">draft</span>
                  )}
                </span>
                <button className="btn-outline !px-3 !py-1 !text-xs" onClick={() => togglePublish(r)}>
                  {r.is_published === 1 ? 'Unpublish' : 'Publish'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

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

      <RecipeStudio products={products} />

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
