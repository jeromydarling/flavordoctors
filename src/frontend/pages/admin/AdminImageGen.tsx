import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { Product } from '../../lib/types';
import { collectionLabel } from '../../lib/types';
import { PageSpinner } from '../../components/Protected';
import { ProductImage } from '../../components/ProductImage';
import { AdminNav } from './AdminNav';

/**
 * Flux image generation console: generate/regenerate product photography per SKU.
 * New images replace the existing object at products/{slug}/hero.png in R2.
 */
export function AdminImageGen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState({ running: false, done: 0, total: 0, failed: 0 });

  useEffect(() => {
    api
      .get<{ products: Product[] }>('/api/admin/products')
      .then((d) => setProducts(d.products))
      .catch(() => setProducts([]));
  }, []);

  const generate = async (p: Product): Promise<boolean> => {
    setBusyIds((prev) => new Set(prev).add(p.id));
    setErrors((prev) => ({ ...prev, [p.id]: '' }));
    try {
      const { imageUrl } = await api.post<{ imageUrl: string }>(`/api/admin/products/${p.id}/generate-image`);
      setProducts((prev) => prev?.map((x) => (x.id === p.id ? { ...x, imageUrl } : x)) ?? null);
      return true;
    } catch (err) {
      setErrors((prev) => ({ ...prev, [p.id]: err instanceof ApiError ? err.message : 'Generation failed' }));
      return false;
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  };

  const generateAllMissing = async () => {
    const queue = products?.filter((p) => !p.imageUrl) ?? [];
    setBulk({ running: true, done: 0, total: queue.length, failed: 0 });
    let done = 0;
    let failed = 0;
    // Sequential on purpose: keeps within Workers AI rate limits.
    for (const p of queue) {
      const ok = await generate(p);
      done += 1;
      if (!ok) failed += 1;
      setBulk({ running: true, done, total: queue.length, failed });
      if (failed >= 3 && failed === done) break; // first three all failed — likely misconfig, stop early
    }
    setBulk((b) => ({ ...b, running: false }));
  };

  const missing = products?.filter((p) => !p.imageUrl).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Flux Product Photography</h2>
          <p className="mt-1 text-medical/60">
            Generates consistent studio shots via Workers AI (flux-1-schnell) and publishes to R2 at{' '}
            <code className="rounded bg-navy-light px-1">products/&#123;slug&#125;/hero.png</code>.
            {missing > 0 && <span className="ml-2 font-bold text-gold">{missing} SKUs missing images.</span>}
          </p>
        </div>
        <div className="text-right">
          <button
            className="btn-gold !py-2 !text-base"
            disabled={bulk.running || missing === 0}
            onClick={generateAllMissing}
          >
            {bulk.running
              ? `Generating… ${bulk.done}/${bulk.total}`
              : missing === 0
                ? 'All images generated ✓'
                : `✦ Generate all ${missing} missing`}
          </button>
          {bulk.total > 0 && !bulk.running && (
            <p className="mt-2 text-sm text-medical/60">
              Batch finished: {bulk.done - bulk.failed} generated{bulk.failed > 0 ? `, ${bulk.failed} failed` : ''}.
            </p>
          )}
        </div>
      </div>

      {products === null ? (
        <PageSpinner />
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const busy = busyIds.has(p.id);
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border-2 border-navy-lighter bg-navy-light">
                <div className="relative">
                  <ProductImage product={p} className="h-48 w-full" />
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-navy/70">
                      <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy-lighter border-t-rx" />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-rx">{collectionLabel(p.collection)}</p>
                  <h3 className="font-heading text-xl font-bold">{p.name}</h3>
                  {errors[p.id] && <p className="mt-2 text-sm text-red-300">{errors[p.id]}</p>}
                  <button className="btn-rx mt-3 w-full !py-2 !text-base" disabled={busy} onClick={() => generate(p)}>
                    {busy ? 'Generating…' : p.imageUrl ? '↻ Regenerate & Publish' : '✦ Generate & Publish'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
