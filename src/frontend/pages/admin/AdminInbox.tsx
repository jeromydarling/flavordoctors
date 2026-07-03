import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface Ticket { id: string; email: string; subject: string; status: string; source: string; updated_at: string }
interface Message { role: string; body: string; created_at: string }

export function AdminInbox() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusView, setStatusView] = useState<'open' | 'closed'>('open');
  const [active, setActive] = useState<{ ticket: Ticket; messages: Message[] } | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = (status = statusView) =>
    api.get<{ tickets: Ticket[]; counts: Record<string, number> }>(`/api/admin/tickets?status=${status}`)
      .then((d) => { setTickets(d.tickets); setCounts(d.counts); });

  useEffect(() => { load().catch(() => setTickets([])); }, [statusView]);

  const openTicket = (id: string) =>
    api.get<{ ticket: Ticket; messages: Message[] }>(`/api/admin/tickets/${id}`).then(setActive).catch(() => {});

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMessage(null);
    try {
      await fn(); setMessage(ok); await load();
      if (active) await openTicket(active.ticket.id);
    } catch (e) { setMessage(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold">Support Inbox</h2>
        {(['open', 'closed'] as const).map((s) => (
          <button key={s} className={`rounded-full px-4 py-1 text-sm font-bold ${statusView === s ? 'bg-rx text-navy' : 'bg-navy-lighter text-medical/70'}`} onClick={() => setStatusView(s)}>
            {s} ({counts[s] ?? 0})
          </button>
        ))}
      </div>
      {message && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}

      {tickets === null ? (
        <PageSpinner />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            {tickets.length === 0 && <p className="text-medical/60">No {statusView} tickets. The waiting room is clear. 🩺</p>}
            {tickets.map((t) => (
              <button key={t.id} className={`block w-full rounded-xl border-2 p-4 text-left transition-colors ${active?.ticket.id === t.id ? 'border-rx bg-navy-light' : 'border-navy-lighter hover:border-medical/40'}`} onClick={() => openTicket(t.id)}>
                <p className="font-bold">{t.subject}</p>
                <p className="text-sm text-medical/60">{t.email} · {t.source} · {new Date(t.updated_at).toLocaleString()}</p>
              </button>
            ))}
          </div>

          {active && (
            <div className="rx-card !p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold">{active.ticket.subject}</p>
                  <p className="text-sm text-medical/60">{active.ticket.email} · ticket {active.ticket.id}</p>
                </div>
                <button className="btn-outline !px-3 !py-1 !text-sm" disabled={busy}
                  onClick={() => act(() => api.post(`/api/admin/tickets/${active.ticket.id}/status`, { status: active.ticket.status === 'open' ? 'closed' : 'open' }), active.ticket.status === 'open' ? 'Ticket closed.' : 'Ticket reopened.')}>
                  {active.ticket.status === 'open' ? 'Close' : 'Reopen'}
                </button>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {active.messages.map((m, i) => (
                  <div key={i} className={`rounded-lg p-3 text-sm ${m.role === 'customer' ? 'bg-navy' : m.role === 'agent' ? 'bg-rx/10' : 'bg-navy-lighter/50'}`}>
                    <p className="mb-1 text-xs font-bold uppercase text-medical/60">{m.role} · {new Date(m.created_at).toLocaleString()}</p>
                    <p className="whitespace-pre-wrap text-medical/90">{m.body}</p>
                  </div>
                ))}
              </div>
              <textarea className="input mt-3 !text-sm" rows={3} placeholder="Reply (emailed to the customer)…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <button className="btn-rx mt-2 !px-4 !py-2 !text-sm" disabled={busy || !reply.trim()}
                onClick={() => act(() => api.post(`/api/admin/tickets/${active.ticket.id}/reply`, { body: reply }).then(() => setReply('')), 'Reply sent + emailed.')}>
                Send Reply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
