import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export function CheckoutResult() {
  const { result } = useParams();
  const cart = useCart();
  const success = result === 'success';

  useEffect(() => {
    if (success) cart.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <span className="text-7xl">{success ? '💊' : '🩹'}</span>
      <h1 className="mt-6 text-5xl font-black">
        {success ? 'Prescription Filled!' : 'Checkout Canceled'}
      </h1>
      <p className="mt-4 text-xl text-medical/70">
        {success
          ? 'Your order is confirmed — a receipt is on its way to your inbox. We’ll ship your treatment shortly.'
          : 'No charge was made. Your cart is right where you left it.'}
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Link to="/menu" className="btn-rx">
          {success ? 'Keep Browsing' : 'Back to the Menu'}
        </Link>
        {success && (
          <Link to="/account" className="btn-outline">
            View My Chart
          </Link>
        )}
      </div>
    </div>
  );
}
