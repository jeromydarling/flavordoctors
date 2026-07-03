import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface StaffRow {
  id: string;
  email: string;
  role: 'support' | 'admin';
  created_at: string;
  allowlisted: boolean;
}
interface AuditRow {
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
}
interface StaffData {
  staff: StaffRow[];
  audit: AuditRow[];
  me: string;
}

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-gold text-navy',
  support: 'bg-rx/20 text-rx',
};

export function AdminStaff() {
  const [data, setData] = useState<StaffData | null>(null);
  const [form, setForm] = useState({ email: '', role: 'support' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<StaffData>('/api/admin/staff').then(setData);
  useEffect(() => {
    load().catch(() => setData({ staff: [], audit: [], me: '' }));
  }, []);

  const setRole = async (email: string, role: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/admin/staff/role', { email, role });
      setMessage(`${email} is now ${role === 'customer' ? 'a customer (access revoked)' : role}.`);
      setForm({ email: '', role: 'support' });
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <h2 className="text-2xl font-bold">Staff &amp; Roles</h2>
      <p className="mt-1 text-sm text-medical/60">
        <strong>Support</strong> reps see Orders, Customers, Inbox, and Analytics. <strong>Admins</strong> see
        everything. Emails on the owner allowlist are re-promoted to admin at every login and can never be locked out.
      </p>

      {message && <p className="mt-4 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}

      {/* Grant access */}
      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border-2 border-navy-lighter p-4">
        <div>
          <label htmlFor="staff-email" className="block text-xs font-bold uppercase text-medical/60">
            Account email
          </label>
          <input
            id="staff-email"
            className="input !w-72 !py-2"
            placeholder="rep@flavordoctors.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="staff-role" className="block text-xs font-bold uppercase text-medical/60">
            Role
          </label>
          <select
            id="staff-role"
            className="input !w-40 !py-2"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="support">Support</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          className="btn-rx !px-4 !py-2"
          disabled={busy || !form.email.trim()}
          onClick={() => setRole(form.email.trim().toLowerCase(), form.role)}
        >
          Grant access
        </button>
      </div>

      {data === null ? (
        <PageSpinner />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-xl border-2 border-navy-lighter">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-navy-light uppercase tracking-wide text-medical/60">
                <tr>
                  <th className="p-3">Email</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Since</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-lighter">
                {data.staff.map((s) => (
                  <tr key={s.id}>
                    <td className="p-3 font-bold text-gold">
                      {s.email}
                      {s.email === data.me && <span className="ml-2 text-xs text-medical/60">(you)</span>}
                      {s.allowlisted && <span className="ml-2 text-xs text-medical/60">🔑 owner</span>}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ROLE_STYLES[s.role]}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="p-3 text-medical/60">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="p-3">
                      {s.email !== data.me && (
                        <span className="flex flex-wrap gap-2">
                          {s.role !== 'admin' && (
                            <button className="btn-gold !px-3 !py-1 !text-xs" disabled={busy} onClick={() => setRole(s.email, 'admin')}>
                              Make admin
                            </button>
                          )}
                          {s.role !== 'support' && (
                            <button className="btn-rx !px-3 !py-1 !text-xs" disabled={busy} onClick={() => setRole(s.email, 'support')}>
                              Make support
                            </button>
                          )}
                          <button
                            className="rounded-lg border border-red-400/40 px-3 py-1 text-xs font-bold text-red-300"
                            disabled={busy}
                            onClick={() => setRole(s.email, 'customer')}
                          >
                            Revoke access
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.staff.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-medical/60" colSpan={4}>
                      No staff yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="mt-10 text-xl font-bold">Audit trail</h3>
          <p className="mt-1 text-sm text-medical/60">
            Sensitive actions — role changes, campaign sends, promos, product edits, order status changes, points
            grants, one-off emails — are logged here with who did what.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border-2 border-navy-lighter">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-navy-light uppercase tracking-wide text-medical/60">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Who</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Target</th>
                  <th className="p-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-lighter">
                {data.audit.map((a, i) => (
                  <tr key={i}>
                    <td className="p-3 whitespace-nowrap text-medical/60">{new Date(a.created_at + 'Z').toLocaleString()}</td>
                    <td className="p-3">{a.actor}</td>
                    <td className="p-3 font-mono text-xs">{a.action}</td>
                    <td className="p-3">{a.target ?? '—'}</td>
                    <td className="p-3 text-medical/60">{a.detail ?? '—'}</td>
                  </tr>
                ))}
                {data.audit.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-medical/60" colSpan={5}>
                      Nothing logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
