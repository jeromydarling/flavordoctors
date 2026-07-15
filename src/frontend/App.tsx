import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequireAdmin, RequireStaff } from './components/Protected';
import { Home } from './pages/Home';
import { Menu } from './pages/Menu';
import { ProductPage } from './pages/Product';
import { Subscribe } from './pages/Subscribe';
import { IntakeExam } from './pages/IntakeExam';
import { Trials } from './pages/Trials';
import { About } from './pages/About';
import { Faq } from './pages/Faq';
import { Login } from './pages/Login';
import { Account } from './pages/Account';
import { Customize } from './pages/Customize';
import { CheckoutResult } from './pages/CheckoutResult';
import { AdminProducts } from './pages/admin/AdminProducts';
import { AdminOrders } from './pages/admin/AdminOrders';
import { AdminImageGen } from './pages/admin/AdminImageGen';
import { AdminAnalytics } from './pages/admin/AdminAnalytics';
import { AdminMarketing } from './pages/admin/AdminMarketing';
import { AdminPromos } from './pages/admin/AdminPromos';
import { AdminContent } from './pages/admin/AdminContent';
import { AdminCustomers } from './pages/admin/AdminCustomers';
import { AdminInbox } from './pages/admin/AdminInbox';
import { AdminStaff } from './pages/admin/AdminStaff';
import { AdminBrand } from './pages/admin/AdminBrand';
import { AdminInventory } from './pages/admin/AdminInventory';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Affiliates } from './pages/Affiliates';
import { AffiliatePortal } from './pages/AffiliatePortal';
import { AdminAffiliates } from './pages/admin/AdminAffiliates';
import { captureAffRef } from './lib/affiliate';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Flavor Doctors — Prescription-Strength Flavor, Small-Batch Sauces & Seasonings',
  '/menu': 'The Menu — All 34 Treatments | Flavor Doctors',
  '/subscribe': 'Monthly Rx Box — Choose Your Own Subscription | Flavor Doctors',
  '/trials': 'Clinical Trials — Limited Flavor Drops | Flavor Doctors',
  '/intake-exam': 'The Intake Exam — Get Your Flavor Diagnosis | Flavor Doctors',
  '/about': 'Our Story | Flavor Doctors',
  '/faq': 'FAQ — Patient Information Leaflet | Flavor Doctors',
  '/login': 'Patient Check-In | Flavor Doctors',
  '/account': 'My Chart | Flavor Doctors',
  '/account/customize': 'Customize Your Rx Box | Flavor Doctors',
};

/** Keep document.title in sync during client-side navigation (edge injection covers first load). */
function RouteTitle() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(search);
    // Referral links (?ref=CODE) stick until the visitor registers.
    const ref = params.get('ref');
    if (ref && /^[A-Z2-9]{6}$/.test(ref)) localStorage.setItem('fd_ref', ref);
    // Affiliate links (?aff=hc_...) attribute checkouts for 30 days.
    const aff = params.get('aff');
    if (aff) captureAffRef(aff);
  }, [search]);
  useEffect(() => {
    // Product pages set their own title once the product loads.
    if (pathname.startsWith('/product/')) return;
    document.title = ROUTE_TITLES[pathname] ?? 'Flavor Doctors';
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
    <RouteTitle />
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/product/:slug" element={<ProductPage />} />
        <Route path="/subscribe" element={<Subscribe />} />
        <Route path="/intake-exam" element={<IntakeExam />} />
        <Route path="/trials" element={<Trials />} />
        <Route path="/about" element={<About />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/affiliates" element={<Affiliates />} />
        <Route
          path="/affiliates/portal"
          element={
            <RequireAuth>
              <AffiliatePortal />
            </RequireAuth>
          }
        />
        <Route path="/checkout/:result" element={<CheckoutResult />} />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route
          path="/account/customize"
          element={
            <RequireAuth>
              <Customize />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/products"
          element={
            <RequireAdmin>
              <AdminProducts />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/orders"
          element={
            <RequireStaff>
              <AdminOrders />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/image-gen"
          element={
            <RequireAdmin>
              <AdminImageGen />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <RequireStaff>
              <AdminAnalytics />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/marketing"
          element={
            <RequireAdmin>
              <AdminMarketing />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/promos"
          element={
            <RequireAdmin>
              <AdminPromos />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/content"
          element={
            <RequireAdmin>
              <AdminContent />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/customers"
          element={
            <RequireStaff>
              <AdminCustomers />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/inbox"
          element={
            <RequireStaff>
              <AdminInbox />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/staff"
          element={
            <RequireAdmin>
              <AdminStaff />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/brand"
          element={
            <RequireAdmin>
              <AdminBrand />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/inventory"
          element={
            <RequireStaff>
              <AdminInventory />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/affiliates"
          element={
            <RequireAdmin>
              <AdminAffiliates />
            </RequireAdmin>
          }
        />
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-xl px-4 py-24 text-center">
              <h1 className="text-5xl font-black">404</h1>
              <p className="mt-4 text-xl text-medical/70">Diagnosis: page not found. Prescribing a return to the homepage.</p>
            </div>
          }
        />
      </Route>
    </Routes>
    </>
  );
}
