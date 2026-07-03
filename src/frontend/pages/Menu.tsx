import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Product } from '../lib/types';
import { COLLECTIONS } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { PageSpinner } from '../components/Protected';

export function Menu() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get('collection');

  useEffect(() => {
    setProducts(null);
    api
      .get<{ products: Product[] }>(`/api/products${active ? `?collection=${active}` : ''}`)
      .then((d) => setProducts(d.products))
      .catch(() => setProducts([]));
  }, [active]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-5xl font-black md:text-6xl">The Menu</h1>
      <p className="mt-3 text-xl text-medical/70">Every item is a prescription. No insurance required.</p>
      <div className="mt-5 flex flex-wrap gap-3 text-sm font-bold">
        <span className="rounded-full bg-rx/10 px-4 py-2 text-rx">🚚 Free shipping over $45</span>
        <span className="rounded-full bg-gold/10 px-4 py-2 text-gold">💊 Any 3+ items: 15% off automatically</span>
        <Link to="/intake-exam" className="rounded-full bg-navy-light px-4 py-2 text-medical/80 hover:text-rx">
          🩺 Not sure? Take the Intake Exam →
        </Link>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <FilterChip label="All Treatments" active={!active} onClick={() => setSearchParams({})} />
        {COLLECTIONS.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            active={active === c.key}
            onClick={() => setSearchParams({ collection: c.key })}
          />
        ))}
      </div>

      <h2 className="sr-only">Products</h2>
      {products === null ? (
        <PageSpinner />
      ) : products.length === 0 ? (
        <p className="py-20 text-center text-xl text-medical/60">No treatments found in this department.</p>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border-2 px-5 py-2 font-bold transition-colors ${
        active ? 'border-rx bg-rx text-navy' : 'border-navy-lighter text-medical/70 hover:border-rx hover:text-rx'
      }`}
    >
      {label}
    </button>
  );
}
