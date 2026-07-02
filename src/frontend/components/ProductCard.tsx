import { Link } from 'react-router-dom';
import type { Product } from '../lib/types';
import { collectionLabel, formatPrice } from '../lib/types';
import { useCart } from '../context/CartContext';
import { ProductImage } from './ProductImage';

export function ProductCard({ product }: { product: Product }) {
  const cart = useCart();
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border-2 border-navy-lighter bg-navy-light transition-all hover:border-rx hover:shadow-xl hover:shadow-rx/10">
      {product.isBestseller && (
        <span className="absolute left-3 top-3 z-10 rounded-full bg-gold px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-navy">
          ★ Best Seller
        </span>
      )}
      <Link to={`/product/${product.slug}`} className="block">
        <ProductImage product={product} className="h-52 w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <span className="text-xs font-bold uppercase tracking-widest text-rx">{collectionLabel(product.collection)}</span>
        <Link to={`/product/${product.slug}`}>
          <h3 className="mt-1 font-heading text-2xl font-bold group-hover:text-gold">{product.name}</h3>
        </Link>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-medical/70">{product.description}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-2xl font-extrabold text-gold">{formatPrice(product.price)}</span>
          <button className="btn-rx !px-4 !py-2 !text-base" onClick={() => cart.add(product)}>
            + Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
