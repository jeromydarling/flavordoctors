import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import type { Product } from '../../lib/types';
import { COLLECTIONS, formatPrice } from '../../lib/types';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface EditState {
  id: string | null; // null = creating
  name: string;
  collection: string;
  description: string;
  price: string; // dollars, as typed
  isActive: boolean;
  isBestseller: boolean;
}

const EMPTY: EditState = {
  id: null,
  name: '',
  collection: 'mayo',
  description: '',
  price: '',
  isActive: true,
  isBestseller: false,
};

export function AdminProducts() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState<string | null>(null);

  const load = () =>
    api.get<{ products: Product[] }>('/api/admin/products').then((d) => setProducts(d.products));

  useEffect(() => {
    load().catch(() => setProducts([]));
  }, []);

  const startEdit = (p: Product) =>
    setEditing({
      id: p.id,
      name: p.name,
      collection: p.collection,
      description: p.description,
      price: (p.price / 100).toFixed(2),
      isActive: p.isActive !== false,
      isBestseller: p.isBestseller,
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    const body = {
      name: editing.name,
      collection: editing.collection,
      description: editing.description,
      price: Math.round(parseFloat(editing.price) * 100),
      isActive: editing.isActive,
      isBestseller: editing.isBestseller,
    };
    try {
      if (editing.id) await api.put(`/api/admin/products/${editing.id}`, body);
      else await api.post('/api/admin/products', body);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (p: Product) => {
    if (!window.confirm(`Deactivate "${p.name}"? It will be hidden from the store.`)) return;
    await api.delete(`/api/admin/products/${p.id}`);
    await load();
  };

  const generateDescription = async (p: Product) => {
    setGenBusy(p.id);
    try {
      await api.post(`/api/admin/products/${p.id}/generate-description`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generation failed');
    } finally {
      setGenBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Product Catalog {products ? `(${products.length})` : ''}</h2>
        <button className="btn-rx !py-2 !text-base" onClick={() => setEditing(EMPTY)}>
          + New Product
        </button>
      </div>
      {error && <p className="mt-4 rounded bg-red-500/20 p-3 text-red-300">{error}</p>}

      {editing && (
        <form onSubmit={submit} className="rx-card mt-6 space-y-4">
          <h3 className="text-xl font-bold">{editing.id ? `Edit: ${editing.name}` : 'New Product'}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold">Name</label>
              <input className="input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold">Collection</label>
              <select className="input" value={editing.collection} onChange={(e) => setEditing({ ...editing, collection: e.target.value })}>
                {COLLECTIONS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold">Description</label>
            <textarea className="input" rows={2} required value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="mb-1 block text-sm font-bold">Price (USD)</label>
              <input className="input w-32" required type="number" step="0.01" min="0.5" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 font-bold">
              <input type="checkbox" className="h-5 w-5" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
              Active
            </label>
            <label className="flex items-center gap-2 font-bold">
              <input type="checkbox" className="h-5 w-5" checked={editing.isBestseller} onChange={(e) => setEditing({ ...editing, isBestseller: e.target.checked })} />
              Best Seller
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn-rx !py-2 !text-base" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-outline !py-2 !text-base" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {products === null ? (
        <PageSpinner />
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border-2 border-navy-lighter">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-navy-light text-sm uppercase tracking-wide text-medical/60">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Collection</th>
                <th className="p-3">Price</th>
                <th className="p-3">Status</th>
                <th className="p-3">Rx Copy</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-lighter">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-navy-light/50">
                  <td className="p-3 font-bold">
                    {p.name}
                    {p.isBestseller && <span className="ml-2 text-gold">★</span>}
                  </td>
                  <td className="p-3 text-medical/70">{p.collection}</td>
                  <td className="p-3 text-gold">{formatPrice(p.price)}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${p.isActive !== false ? 'bg-rx/20 text-rx' : 'bg-red-500/20 text-red-300'}`}>
                      {p.isActive !== false ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="p-3">
                    <button
                      className="text-sm font-bold text-rx hover:underline disabled:opacity-50"
                      disabled={genBusy === p.id}
                      onClick={() => generateDescription(p)}
                      title={p.aiDescription ?? 'No AI description yet'}
                    >
                      {genBusy === p.id ? 'Writing…' : p.aiDescription ? 'Regenerate' : 'Generate'}
                    </button>
                  </td>
                  <td className="p-3 text-right">
                    <button className="mr-3 font-bold text-gold hover:underline" onClick={() => startEdit(p)}>
                      Edit
                    </button>
                    <button className="font-bold text-red-300 hover:underline" onClick={() => deactivate(p)}>
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
