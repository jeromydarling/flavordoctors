import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-5 py-2 font-bold transition-colors ${
    isActive ? 'bg-rx text-navy' : 'text-medical/70 hover:text-rx'
  }`;

// Which tabs each role can see. Support reps get the customer-facing wing;
// admins get everything plus staff management.
const TABS: { to: string; label: string; adminOnly?: boolean }[] = [
  { to: '/admin/products', label: 'Products', adminOnly: true },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/inventory', label: 'Inventory' },
  { to: '/admin/image-gen', label: 'Image Gen', adminOnly: true },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/customers', label: 'Customers' },
  { to: '/admin/inbox', label: 'Inbox' },
  { to: '/admin/marketing', label: 'Marketing', adminOnly: true },
  { to: '/admin/brand', label: 'Brand Studio', adminOnly: true },
  { to: '/admin/crm', label: 'CRM' },
  { to: '/admin/promos', label: 'Sales & Pages', adminOnly: true },
  { to: '/admin/content', label: 'Content Studio', adminOnly: true },
  { to: '/admin/affiliates', label: 'Affiliates', adminOnly: true },
  { to: '/admin/staff', label: 'Staff', adminOnly: true },
];

export function AdminNav() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  return (
    <div className="mb-8">
      <h1 className="text-4xl font-black">
        Staff Only <span className="text-rx">🩺</span>
      </h1>
      <nav className="mt-4 flex flex-wrap gap-2 rounded-xl border-2 border-navy-lighter bg-navy-light p-2">
        {TABS.filter((t) => isAdmin || !t.adminOnly).map((t) => (
          <NavLink key={t.to} to={t.to} className={tabClass}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
