import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Product } from '../lib/types';
import { collectionLabel, formatPrice } from '../lib/types';
import { useCart } from '../context/CartContext';
import { ProductImage } from '../components/ProductImage';
import { PageSpinner } from '../components/Protected';

export function ProductPage() {
  const { slug } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const cart = useCart();

  useEffect(() => {
    setProduct(null);
    setNotFound(false);
    api
      .get<{ product: Product }>(`/api/products/${slug}`)
      .then((d) => {
        setProduct(d.product);
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
          <div className="mt-8 flex flex-wrap gap-4">
            <button className="btn-rx" onClick={() => cart.add(product)}>
              + Add to Cart
            </button>
            <Link to="/subscribe" className="btn-outline">
              Or get it in your Rx Box
            </Link>
          </div>

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
