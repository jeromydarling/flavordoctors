import { useState } from 'react';
import type { Product } from '../lib/types';

const COLLECTION_EMOJI: Record<string, string> = {
  mayo: '🫙',
  butter: '🧈',
  'burger-sauce': '🍔',
  toppers: '🍨',
  seasoning: '🍟',
};

/** Product hero image with a branded placeholder until Flux images are generated. */
export function ProductImage({ product, className = '' }: { product: Product; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-navy-light to-navy-lighter ${className}`}
        aria-label={product.name}
      >
        <span className="text-6xl" role="img" aria-hidden="true">
          {COLLECTION_EMOJI[product.collection] ?? '💊'}
        </span>
        <span className="mt-2 px-3 text-center font-heading text-lg font-bold text-gold">{product.name}</span>
        <span className="text-xs uppercase tracking-widest text-medical/60">Image pending Rx</span>
      </div>
    );
  }
  return (
    <img
      src={product.imageUrl}
      alt={product.name}
      className={`object-cover ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
