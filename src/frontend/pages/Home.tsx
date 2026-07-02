import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Product } from '../lib/types';
import { COLLECTIONS, TIERS, formatPrice } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { LogoMark } from '../components/Logo';

export function Home() {
  const [featured, setFeatured] = useState<Product[]>([]);

  useEffect(() => {
    api
      .get<{ products: Product[] }>('/api/products')
      .then((d) => {
        const best = d.products.filter((p) => p.isBestseller);
        setFeatured((best.length >= 4 ? best : d.products).slice(0, 8));
      })
      .catch(() => setFeatured([]));
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-rx/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 bottom-0 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
          <div>
            <p className="mb-4 inline-block rounded-full border-2 border-rx px-4 py-1 text-sm font-extrabold uppercase tracking-widest text-rx">
              ℞ Board-certified flavor
            </p>
            <h1 className="text-5xl font-black leading-tight md:text-7xl">
              The doctor is <span className="text-rx">in</span>.<br />
              Your food is <span className="text-gold">cured</span>.
            </h1>
            <p className="mt-6 max-w-lg text-xl leading-relaxed text-medical/70">
              Small-batch doctored mayos, compound butters, burger sauces, ice cream toppers, and fry
              seasonings — prescribed for chronic blandness.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/menu" className="btn-rx">
                Browse the Menu
              </Link>
              <Link to="/subscribe" className="btn-gold">
                Get the Monthly Rx Box
              </Link>
            </div>
          </div>
          <div className="hidden justify-center md:flex">
            <div className="prescription-pad w-full max-w-md rotate-2">
              <div className="flex items-center justify-between border-b-2 border-dashed border-navy/30 pb-4">
                <LogoMark className="h-14 w-14" />
                <div className="text-right">
                  <p className="font-heading text-2xl font-black">Flavor Doctors</p>
                  <p className="text-sm text-navy/60">Flavor Clinic — Open 24/7</p>
                </div>
              </div>
              <div className="py-6 font-heading text-lg leading-loose">
                <p><span className="font-black">Patient:</span> Your Dinner</p>
                <p><span className="font-black">Diagnosis:</span> Chronic Blandness</p>
                <p><span className="font-black">Prescription:</span> 1 jar, applied liberally</p>
                <p><span className="font-black">Refills:</span> Monthly (see Rx Box)</p>
              </div>
              <div className="border-t-2 border-dashed border-navy/30 pt-4 text-right font-heading text-2xl italic text-rx-dark">
                Dr. Flavor, MD
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Collections */}
      <section className="border-y border-navy-lighter bg-navy-light/40">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <h2 className="text-center text-4xl font-black md:text-5xl">Departments</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {COLLECTIONS.map((c) => (
              <Link
                key={c.key}
                to={`/menu?collection=${c.key}`}
                className="rx-card text-center transition-colors hover:border-rx"
              >
                <h3 className="text-xl font-bold text-gold">{c.label}</h3>
                <p className="mt-2 text-sm text-medical/60">{c.blurb}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured products */}
      <section className="mx-auto max-w-7xl px-4 py-16">
        <div className="flex items-end justify-between">
          <h2 className="text-4xl font-black md:text-5xl">Most Prescribed</h2>
          <Link to="/menu" className="font-bold text-rx hover:underline">
            View all →
          </Link>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* Subscription CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <div className="rounded-2xl border-2 border-gold bg-gradient-to-br from-navy-light to-navy-lighter p-8 md:p-14">
          <div className="md:flex md:items-center md:justify-between md:gap-12">
            <div>
              <h2 className="text-4xl font-black md:text-5xl">
                The Monthly <span className="text-gold">Rx Box</span>
              </h2>
              <p className="mt-4 max-w-xl text-xl text-medical/70">
                A recurring prescription of doctored delights, starting at{' '}
                <span className="font-bold text-rx">{formatPrice(TIERS[0].price)}/month</span>. Choose your own
                treatment or trust the doctor's orders.
              </p>
            </div>
            <Link to="/subscribe" className="btn-gold mt-8 shrink-0 md:mt-0">
              Start My Prescription →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
