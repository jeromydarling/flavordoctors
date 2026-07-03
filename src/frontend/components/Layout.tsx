import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Logo, LogoMark } from './Logo';
import { Pharmacist } from './Pharmacist';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { formatPrice, FREE_SHIPPING_THRESHOLD, BUNDLE_MIN_QTY, BUNDLE_PERCENT, type LoyaltyInfo } from '../lib/types';
import { api } from '../lib/api';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-lg font-semibold transition-colors hover:text-rx ${isActive ? 'text-rx' : 'text-medical/80'}`;

export function Layout() {
  const { user, logout } = useAuth();
  const cart = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const links = (
    <>
      <NavLink to="/menu" className={navLinkClass} onClick={() => setMobileOpen(false)}>
        The Menu
      </NavLink>
      <NavLink to="/subscribe" className={navLinkClass} onClick={() => setMobileOpen(false)}>
        Rx Box
      </NavLink>
      <NavLink to="/trials" className={navLinkClass} onClick={() => setMobileOpen(false)}>
        Clinical Trials
      </NavLink>
      <NavLink to="/about" className={navLinkClass} onClick={() => setMobileOpen(false)}>
        About
      </NavLink>
      <NavLink to="/faq" className={navLinkClass} onClick={() => setMobileOpen(false)}>
        FAQ
      </NavLink>
      {user && (user.role === 'admin' || user.role === 'support') && (
        <NavLink
          to={user.role === 'admin' ? '/admin/products' : '/admin/orders'}
          className={navLinkClass}
          onClick={() => setMobileOpen(false)}
        >
          {user.role === 'admin' ? 'Admin' : 'Staff'}
        </NavLink>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <PromoBanner />
      <header className="sticky top-0 z-40 border-b border-navy-lighter bg-navy/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" aria-label="Flavor Doctors home">
            <Logo compact />
          </Link>
          <nav className="hidden items-center gap-8 lg:flex">{links}</nav>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="hidden items-center gap-3 sm:flex">
                <Link to="/account" className="text-lg font-semibold text-medical/80 hover:text-rx">
                  My Chart
                </Link>
                <button
                  className="text-sm text-medical/60 hover:text-medical"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link to="/login" className="hidden text-lg font-semibold text-medical/80 hover:text-rx sm:block">
                Sign In
              </Link>
            )}
            <button
              className="relative rounded-lg border-2 border-navy-lighter px-4 py-2 font-bold hover:border-rx"
              onClick={() => cart.setOpen(true)}
              aria-label={`Open cart, ${cart.count} items`}
            >
              🛒
              {cart.count > 0 && (
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rx text-xs font-extrabold text-navy">
                  {cart.count}
                </span>
              )}
            </button>
            <button
              className="rounded-lg border-2 border-navy-lighter px-3 py-2 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              ☰
            </button>
          </div>
        </div>
        {mobileOpen && (
          <nav className="flex flex-col gap-4 border-t border-navy-lighter px-6 py-4 lg:hidden">
            {links}
            {user ? (
              <Link to="/account" className="text-lg font-semibold text-medical/80" onClick={() => setMobileOpen(false)}>
                My Chart
              </Link>
            ) : (
              <Link to="/login" className="text-lg font-semibold text-medical/80" onClick={() => setMobileOpen(false)}>
                Sign In
              </Link>
            )}
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <CartDrawer />
      <Pharmacist />

      <footer className="border-t border-navy-lighter bg-navy-light/50">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-3">
          <div>
            <Logo compact />
            <p className="mt-3 text-sm leading-relaxed text-medical/60">
              Small-batch sauces & seasonings, prescribed for maximum flavor. Take with food.
            </p>
          </div>
          <div className="text-sm text-medical/70">
            <h2 className="mb-3 text-lg font-bold text-medical">Clinic Hours</h2>
            <p>Online 24/7 — the flavor pharmacy never closes.</p>
            <p className="mt-2">
              Questions? Read the <Link to="/faq" className="text-rx underline">Patient Information Leaflet</Link>.
            </p>
          </div>
          <div className="text-sm text-medical/70">
            <h2 className="mb-3 text-lg font-bold text-medical">Warning Label</h2>
            <p>Side effects may include eating this on everything. © {new Date().getFullYear()} Flavor Doctors.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PromoBanner() {
  const [promo, setPromo] = useState<{ code: string; bannerText: string; endsAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.get<{ promo: typeof promo }>('/api/promo/active').then((d) => setPromo(d.promo)).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!promo) return null;
  const remaining = new Date(promo.endsAt).getTime() - now;
  if (remaining <= 0) return null;
  const d = Math.floor(remaining / 86400000);
  const h = Math.floor((remaining % 86400000) / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="bg-gold px-4 py-2 text-center text-sm font-extrabold text-navy">
      💊 {promo.bannerText} — code <span className="rounded bg-navy px-2 py-0.5 text-gold">{promo.code}</span>
      <span className="ml-2 tabular-nums">
        ends in {d > 0 ? `${d}d ` : ''}{h}h {m}m {s}s
      </span>
    </div>
  );
}

function CartDrawer() {
  const cart = useCart();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);

  useEffect(() => {
    if (cart.isOpen && user) {
      api.get<LoyaltyInfo>('/api/account/loyalty').then(setLoyalty).catch(() => setLoyalty(null));
    }
    if (!cart.isOpen) setRedeemPoints(0);
  }, [cart.isOpen, user]);

  // Redeemable blocks that fit this cart (leave ≥ $0.50 for Stripe's minimum).
  const block = loyalty?.redemption?.block ?? 500;
  const maxByBalance = loyalty?.redemption?.redeemablePoints ?? 0;
  const maxByCart = Math.floor(Math.max(0, cart.total - 50) / block) * block;
  const maxRedeem = Math.min(maxByBalance, maxByCart);
  const redeemOptions = [];
  for (let p = block; p <= maxRedeem; p += block) redeemOptions.push(p);
  const pointsValue = redeemPoints; // 1 pt = 1¢

  const checkout = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>('/api/checkout', {
        items: cart.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        ...(redeemPoints > 0 ? { redeemPoints } : {}),
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setBusy(false);
    }
  };

  if (!cart.isOpen) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Shopping cart">
      <div className="absolute inset-0 bg-black/60" onClick={() => cart.setOpen(false)} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-navy-light shadow-2xl">
        <div className="flex items-center justify-between border-b border-navy-lighter p-5">
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <LogoMark className="h-7 w-7" /> Your Prescription
          </h2>
          <button className="text-3xl leading-none text-medical/60 hover:text-medical" onClick={() => cart.setOpen(false)} aria-label="Close cart">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {cart.lines.length === 0 ? (
            <p className="py-12 text-center text-medical/60">
              Your cart is empty. The doctor recommends immediate treatment.
            </p>
          ) : (
            <ul className="space-y-4">
              {cart.lines.map((l) => (
                <li key={l.product.id} className="flex items-center gap-3 rounded-lg border border-navy-lighter p-3">
                  <div className="flex-1">
                    <p className="font-bold">{l.product.name}</p>
                    <p className="text-sm text-gold">{formatPrice(l.product.price)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="h-8 w-8 rounded bg-navy-lighter font-bold hover:bg-rx hover:text-navy"
                      onClick={() => cart.setQuantity(l.product.id, l.quantity - 1)}
                      aria-label={`Decrease ${l.product.name}`}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-bold">{l.quantity}</span>
                    <button
                      className="h-8 w-8 rounded bg-navy-lighter font-bold hover:bg-rx hover:text-navy"
                      onClick={() => cart.setQuantity(l.product.id, l.quantity + 1)}
                      aria-label={`Increase ${l.product.name}`}
                    >
                      +
                    </button>
                  </div>
                  <button className="text-medical/60 hover:text-red-400" onClick={() => cart.remove(l.product.id)} aria-label={`Remove ${l.product.name}`}>
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-navy-lighter p-5">
          {error && <p className="mb-3 rounded bg-red-500/20 p-2 text-sm text-red-300">{error}</p>}
          {cart.lines.length > 0 && (
            <div className="mb-3 space-y-1 text-sm">
              {cart.count >= BUNDLE_MIN_QTY ? (
                <p className="font-bold text-rx">✓ Bundle bonus: {BUNDLE_PERCENT}% off applied at checkout</p>
              ) : (
                <p className="text-medical/60">
                  Add {BUNDLE_MIN_QTY - cart.count} more item{BUNDLE_MIN_QTY - cart.count > 1 ? 's' : ''} for {BUNDLE_PERCENT}% off
                </p>
              )}
              {cart.total >= FREE_SHIPPING_THRESHOLD ? (
                <p className="font-bold text-rx">✓ Free shipping unlocked</p>
              ) : (
                <p className="text-medical/60">
                  {formatPrice(FREE_SHIPPING_THRESHOLD - cart.total)} away from free shipping
                </p>
              )}
            </div>
          )}
          {user && cart.lines.length > 0 && redeemOptions.length > 0 && (
            <div className="mb-3 rounded-lg border border-gold/40 p-3 text-sm">
              <label htmlFor="redeem-points" className="font-bold text-gold">
                💊 Board Certification points ({loyalty?.points ?? 0} available)
              </label>
              <div className="mt-2 flex items-center gap-2">
                <select
                  id="redeem-points"
                  className="input !w-auto !py-1 !text-sm"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(parseInt(e.target.value, 10))}
                >
                  <option value={0}>Don't redeem</option>
                  {redeemOptions.map((p) => (
                    <option key={p} value={p}>
                      {p} pts → {formatPrice(p)} off
                    </option>
                  ))}
                </select>
                {redeemPoints > 0 && <span className="font-bold text-rx">−{formatPrice(pointsValue)}</span>}
              </div>
            </div>
          )}
          <div className="mb-4 flex justify-between text-xl font-bold">
            <span>Total</span>
            <span className="text-gold">
              {redeemPoints > 0 ? (
                <>
                  <s className="mr-2 text-medical/50">{formatPrice(cart.total)}</s>
                  {formatPrice(Math.max(0, cart.total - pointsValue))}
                </>
              ) : (
                formatPrice(cart.total)
              )}
            </span>
          </div>
          <button className="btn-rx w-full" disabled={cart.lines.length === 0 || busy} onClick={checkout}>
            {busy ? 'Preparing checkout…' : 'Fill Prescription → Checkout'}
          </button>
        </div>
      </aside>
    </div>
  );
}
