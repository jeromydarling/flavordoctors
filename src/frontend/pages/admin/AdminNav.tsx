import { NavLink } from 'react-router-dom';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-5 py-2 font-bold transition-colors ${
    isActive ? 'bg-rx text-navy' : 'text-medical/70 hover:text-rx'
  }`;

export function AdminNav() {
  return (
    <div className="mb-8">
      <h1 className="text-4xl font-black">
        Staff Only <span className="text-rx">🩺</span>
      </h1>
      <nav className="mt-4 flex flex-wrap gap-2 rounded-xl border-2 border-navy-lighter bg-navy-light p-2">
        <NavLink to="/admin/products" className={tabClass}>
          Products
        </NavLink>
        <NavLink to="/admin/orders" className={tabClass}>
          Orders
        </NavLink>
        <NavLink to="/admin/image-gen" className={tabClass}>
          Image Generation
        </NavLink>
      </nav>
    </div>
  );
}
