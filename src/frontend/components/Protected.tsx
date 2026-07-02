import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: '/admin/products' }} replace />;
  if (!user.isAdmin) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-4xl font-bold">Restricted Area 🩺</h1>
        <p className="mt-4 text-medical/70">This wing of the clinic is for medical staff only.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export function PageSpinner() {
  return (
    <div className="flex justify-center py-32" role="status" aria-label="Loading">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-navy-lighter border-t-rx" />
    </div>
  );
}
