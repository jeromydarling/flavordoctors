import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatPrice } from '../../lib/types';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface CustomerRow {
  email: string; userId: string | null; stage: string; ordersCount: number; lifetimeSpend: number;
  lastOrderAt: string | null; subStatus: string | null; points: number; consent: boolean; source: string | null;
}
interface Detail {
  email: string; userId: string | null; stage: string; consent: boolean; source: string | null; since: string | null;
  ordersCount: number; lifetimeSpend: number; points: number; quizCondition: string | null;
  orders: { id: string; total: number; status: string; created_at: string }[];
  subscription: { tierName: string; status: string; cadenceLabel: string } | null;
  pointsLedger: { delta: number; reason: string; created_at: string }[];
  notes: { id: number; author: string; body: string; created_at: string }[];
  tickets: { id: string; subject: string; status: string; updated_at: string }[];
  emailLog: { kind: string; ref: string; created_at: string }[];
  reviews: { rating: number; body: string; approved: number; name: string }[];
}

const STAGE_STYLES: Record<string, string> = {
  vip: 'bg-gold text-navy', subscriber: 'bg-rx/20 text-rx', at_risk: 'bg-red-500/20 text-red-300',
  customer: 'bg-rx/10 text-medical', lapsed: 'bg-medical/10 text-medical/60', lead: 'bg-navy-lighter text-medical/70',
};
const STAGE_LABELS: Record<string, string> = {
  vip: 'VIP', subscriber: 'Subscriber', at_risk: 'At risk', customer: 'Customer', lapsed: 'Lapsed', lead: 'Lead',
};

export function AdminCustomers() {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [stages, setStages] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pointsDelta, setPointsDelta] = useState('50');
  const [emailForm, setEmailForm] = useState({ subject: '', body: '' });
  const [busy, setBusy] = useState(false);

  const load = (q = '') =>
    api.get<{ customers: CustomerRow[]; stages: Record<string, number> }>(`/api/admin/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      .then((d) => { setCustomers(d.customers); setStages(d.stages); });

  useEffect(() => { load().catch(() => setCustomers([])); }, []);

  const openDetail = (email: string) =>
    api.get<Detail>(`/api/admin/customers/detail?email=${encodeURIComponent(email)}`).then(setDetail).catch(() => {});

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMessage(null);
    try { await fn(); setMessage(ok); if (detail) await openDetail(detail.email); }
    catch (e) { setMessage(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  const visible = (customers ?? []).filter((c) => !stageFilter || c.stage === stageFilter);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold">Patients {customers ? `(${customers.length})` : ''}</h2>
        <input
          className="input !w-64 !py-2" placeholder="Search email…" value={search}
          onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
        />
        <div className="flex flex-wrap gap-2">
          <button className={`rounded-full px-3 py-1 text-xs font-bold ${!stageFilter ? 'bg-rx text-navy' : 'bg-navy-lighter text-medical/70'}`} onClick={() => setStageFilter('')}>
            All
          </button>
          {Object.entries(STAGE_LABELS).map(([key, label]) => (
            <button key={key} className={`rounded-full px-3 py-1 text-xs font-bold ${stageFilter === key ? 'bg-rx text-navy' : STAGE_STYLES[key]}`} onClick={() => setStageFilter(stageFilter === key ? '' : key)}>
              {label} ({stages[key] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {customers === null ? (
        <PageSpinner />
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border-2 border-navy-lighter">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-navy-light uppercase tracking-wide text-medical/60">
              <tr><th className="p-3">Email</th><th className="p-3">Stage</th><th className="p-3">Orders</th><th className="p-3">LTV</th><th className="p-3">Points</th><th className="p-3">Last order</th><th className="p-3">Consent</th></tr>
            </thead>
            <tbody className="divide-y divide-navy-lighter">
              {visible.map((c) => (
                <tr key={c.email} className="cursor-pointer hover:bg-navy-light/50" onClick={() => openDetail(c.email)}>
                  <td className="p-3 font-bold text-gold">{c.email}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STAGE_STYLES[c.stage]}`}>{STAGE_LABELS[c.stage]}</span></td>
                  <td className="p-3">{c.ordersCount}</td>
                  <td className="p-3">{formatPrice(c.lifetimeSpend)}</td>
                  <td className="p-3">{c.points}</td>
                  <td className="p-3 text-medical/60">{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}</td>
                  <td className="p-3">{c.consent ? '✓' : '✕'}</td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td className="p-6 text-center text-medical/60" colSpan={7}>No patients match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer file drawer */}
      {detail && (
        <div className="fixed inset-0 z-50" role="dialog">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetail(null)} />
          <aside className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-navy-light p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-2xl font-black text-gold">{detail.email}</h3>
                <p className="mt-1 text-sm text-medical/60">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-bold ${STAGE_STYLES[detail.stage]}`}>{STAGE_LABELS[detail.stage]}</span>
                  {detail.ordersCount} orders · {formatPrice(detail.lifetimeSpend)} LTV · {detail.points} pts
                  {detail.quizCondition && <> · dx: {detail.quizCondition}</>}
                </p>
                <p className="text-xs text-medical/60">source: {detail.source ?? '—'} · since {detail.since ? new Date(detail.since).toLocaleDateString() : '—'} · consent {detail.consent ? 'yes' : 'no'}</p>
              </div>
              <button className="text-3xl text-medical/60" onClick={() => setDetail(null)} aria-label="Close">×</button>
            </div>

            {message && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}

            {detail.subscription && (
              <p className="mt-4 rounded-lg border border-navy-lighter p-3 text-sm">
                <strong>{detail.subscription.tierName}</strong> · {detail.subscription.cadenceLabel} · {detail.subscription.status}
              </p>
            )}

            <h4 className="mt-5 font-bold">Orders</h4>
            <ul className="mt-1 space-y-1 text-sm text-medical/80">
              {detail.orders.length === 0 && <li className="text-medical/60">None</li>}
              {detail.orders.map((o) => (
                <li key={o.id}>{new Date(o.created_at).toLocaleDateString()} — {formatPrice(o.total)} <span className="text-medical/60">({o.status})</span></li>
              ))}
            </ul>

            <h4 className="mt-5 font-bold">Tickets</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {detail.tickets.length === 0 && <li className="text-medical/60">None</li>}
              {detail.tickets.map((t) => (
                <li key={t.id}><span className={t.status === 'open' ? 'text-gold' : 'text-medical/60'}>[{t.status}]</span> {t.subject}</li>
              ))}
            </ul>

            <h4 className="mt-5 font-bold">Recent emails</h4>
            <ul className="mt-1 space-y-1 text-xs text-medical/60">
              {detail.emailLog.length === 0 && <li>None logged</li>}
              {detail.emailLog.map((e, i) => <li key={i}>{e.kind}:{e.ref} — {new Date(e.created_at).toLocaleDateString()}</li>)}
            </ul>

            <h4 className="mt-5 font-bold">Notes</h4>
            <div className="mt-1 space-y-2">
              {detail.notes.map((n) => (
                <p key={n.id} className="rounded bg-navy p-2 text-sm"><span className="text-medical/60">{n.author}:</span> {n.body}</p>
              ))}
              <div className="flex gap-2">
                <input className="input !py-2 !text-sm" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn-rx shrink-0 !px-3 !py-2 !text-sm" disabled={busy || !note.trim()}
                  onClick={() => act(() => api.post('/api/admin/customers/note', { email: detail.email, body: note }).then(() => setNote('')), 'Note added.')}>
                  Add
                </button>
              </div>
            </div>

            <h4 className="mt-5 font-bold">Actions</h4>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className="input !w-24 !py-2 !text-sm" type="number" value={pointsDelta} onChange={(e) => setPointsDelta(e.target.value)} />
              <button className="btn-gold !px-3 !py-2 !text-sm" disabled={busy || !detail.userId}
                title={detail.userId ? '' : 'Requires a registered account'}
                onClick={() => act(() => api.post('/api/admin/customers/points', { email: detail.email, delta: parseInt(pointsDelta, 10), reason: 'goodwill' }), 'Points granted.')}>
                Grant points
              </button>
            </div>
            <div className="mt-3 space-y-2">
              <input className="input !py-2 !text-sm" placeholder="Email subject" value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
              <textarea className="input !text-sm" rows={3} placeholder="Message (plain text)" value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} />
              <button className="btn-rx !px-3 !py-2 !text-sm" disabled={busy || !emailForm.subject.trim() || !emailForm.body.trim()}
                onClick={() => act(() => api.post('/api/admin/customers/email', { email: detail.email, ...emailForm }).then(() => setEmailForm({ subject: '', body: '' })), 'Email sent.')}>
                Send one-off email
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
