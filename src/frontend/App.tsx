import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequireAdmin } from './components/Protected';
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

export default function App() {
  return (
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
            <RequireAdmin>
              <AdminOrders />
            </RequireAdmin>
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
  );
}
