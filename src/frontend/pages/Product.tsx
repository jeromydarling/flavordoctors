import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/types';
import { collectionLabel, formatPrice } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { ProductImage } from '../components/ProductImage';
import { PageSpinner } from '../components/Protected';

function RestockNotify({ productId }: { productId: string }) {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subscribe = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.post<{ message: string }>(`/api/products/${productId}/restock-alert`, user ? {} : { email });
      setMessage(d.message);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 rounded-xl border-2 border-gold/50 p-4">
      <p className="font-bold text-gold">Temporarily out of stock</p>
      <p className="mt-1 text-sm text-medical/70">This batch sold out. We'll email you the moment the next one lands.</p>
      {message ? (
        <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {!user && (
            <input
              aria-label="Email for restock alert"
              type="email"
              className="input !w-64 !py-2 !text-sm"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <button className="btn-gold !px-4 !py-2 !text-sm" disabled={busy || (!user && !email.trim())} onClick={subscribe}>
            🔔 Notify me when it's back
          </button>
        </div>
      )}
    </div>
  );
}

interface Review {
  rating: number;
  body: string;
  createdAt: string;
  author: string;
}

function Reviews({ slug }: { slug: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  useEffect(() => {
    api.get<{ reviews: Review[] }>(`/api/products/${slug}/reviews`).then((d) => setReviews(d.reviews)).catch(() => {});
  }, [slug]);
  if (reviews.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold">Patient Testimonials</h2>
      <div className="mt-3 space-y-3">
        {reviews.map((r, i) => (
          <div key={i} className="rounded-xl border border-navy-lighter bg-navy-light p-4">
            <p className="text-gold" aria-label={`${r.rating} out of 5 stars`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</p>
            <p className="mt-1 text-medical/80">{r.body}</p>
            <p className="mt-1 text-xs text-medical/60">— {r.author}, {new Date(r.createdAt).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProductPage() {
  const { slug } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [plans, setPlans] = useState<{ slug: string; title: string }[]>([]);
  const [notFound, setNotFound] = useState(false);
  const cart = useCart();

  useEffect(() => {
    setProduct(null);
    setPlans([]);
    setNotFound(false);
    api
      .get<{ product: Product; recipes?: { slug: string; title: string }[] }>(`/api/products/${slug}`)
      .then((d) => {
        setProduct(d.product);
        setPlans(d.recipes ?? []);
        document.title = `${d.product.name} | Flavor Doctors`;
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-4xl font-black">Prescription not found</h1>
        <Link to="/menu" className="btn-rx mt-8">
          Back to the Menu
        </Link>
      </div>
    );
  }
  if (!product) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <Link to="/menu" className="text-rx hover:underline">
        ← Back to the Menu
      </Link>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border-2 border-navy-lighter">
          <ProductImage product={product} className="aspect-square w-full" />
        </div>
        <div>
          <span className="text-sm font-bold uppercase tracking-widest text-rx">
            {collectionLabel(product.collection)}
          </span>
          <h1 className="mt-2 text-5xl font-black">{product.name}</h1>
          <p className="mt-4 text-xl leading-relaxed text-medical/80">{product.description}</p>
          <p className="mt-6 text-4xl font-extrabold text-gold">{formatPrice(product.price)}</p>
          {product.inStock === false ? (
            <RestockNotify productId={product.id} />
          ) : (
            <div className="mt-8 flex flex-wrap gap-4">
              <button className="btn-rx" onClick={() => cart.add(product)}>
                + Add to Cart
              </button>
              <Link to="/subscribe" className="btn-outline">
                Or get it in your Rx Box
              </Link>
            </div>
          )}

          {plans.length > 0 && (
            <div className="mt-8 rounded-xl border border-navy-lighter bg-navy-light p-4">
              <p className="text-sm font-bold uppercase tracking-widest text-rx">Treatment plans featuring this</p>
              <ul className="mt-2 space-y-1">
                {plans.map((p) => (
                  <li key={p.slug}>
                    <a className="text-gold hover:underline" href={`/treatment-plans/${p.slug}`}>
                      {p.title} →
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(product.ingredients || product.allergens) && (
            <div className="mt-10 rounded-2xl border-2 border-navy-lighter bg-navy-light/40 p-6">
              <h2 className="text-sm font-bold uppercase tracking-widest text-medical/60">Active Ingredients</h2>
              {product.ingredients && (
                <p className="mt-3 text-sm leading-relaxed text-medical/80">{product.ingredients}</p>
              )}
              {product.allergens && (
                <p className="mt-3 text-sm font-bold text-gold">
                  ⚠ Allergen information: <span className="font-normal text-medical/80">{product.allergens}</span>
                </p>
              )}
              <p className="mt-3 text-xs text-medical/50">
                Always check the label on your jar — it is the authoritative source for ingredients and allergens.
              </p>
            </div>
          )}

          <Reviews slug={product.slug} />

          {/* Prescription-style AI description */}
          <div className="prescription-pad mt-10">
            <div className="flex items-center justify-between border-b-2 border-dashed border-navy/30 pb-3">
              <span className="font-heading text-3xl font-black">℞</span>
              <span className="text-sm font-bold uppercase tracking-widest text-navy/60">
                Doctor's Notes — {product.name}
              </span>
            </div>
            <div className="whitespace-pre-line pt-4 font-heading text-lg leading-relaxed">
              {product.aiDescription ??
                `Prescribed for: ${product.description}\nDosage: Apply liberally, as needed.\nSide effects: You'll eat this on everything.`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
