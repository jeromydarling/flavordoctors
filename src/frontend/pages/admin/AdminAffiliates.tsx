import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatPrice } from '../../lib/types';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface Row {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  links: string[];
  audience: string | null;
  pitch: string | null;
  status: string;
  aiScore: number | null;
  aiReasoning: string | null;
  code: string | null;
  codeSynced: boolean;
  tierName: string;
  probation: boolean;
  payoutMethod: string;
  clicks30d: number;
  conversions: number;
  attributedRevenue: number;
  balances: { pending: number; cleared: number; paidOut: number };
  flags: string[];
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gold/20 text-gold',
  approved: 'bg-rx/20 text-rx',
  rejected: 'bg-medical/10 text-medical/60',
  paused: 'bg-red-500/20 text-red-300',
  banned: 'bg-red-500/20 text-red-300',
};

export function AdminAffiliates() {
  const [data, setData] = useState<{ affiliates: Row[]; program: { revenue: number; commissions: number } } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payoutReport, setPayoutReport] = useState<{ paid: { email: string; amount: number; method: string }[]; skipped: { email: string; reason: string }[] } | null>(null);

  const load = () => api.get<typeof data>('/api/admin/affiliates').then(setData);
  useEffect(() => {
    load().catch(() => setData({ affiliates: [], program: { revenue: 0, commissions: 0 } }));
  }, []);

  const decide = async (id: string, action: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/api/admin/affiliates/${id}/decision`, { action });
      setMessage(`Done: ${action}.`);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const releasePayouts = async () => {
    setBusy(true);
    setMessage(null);
    setPayoutReport(null);
    try {
      const report = await api.post<typeof payoutReport>('/api/admin/affiliates/payouts/release');
      setPayoutReport(report);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Payout run failed');
    } finally {
      setBusy(false);
    }
  };

  if (!data)
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <AdminNav />
        <PageSpinner />
      </div>
    );

  const pending = data.affiliates.filter((a) => a.status === 'pending');
  const roster = data.affiliates.filter((a) => a.status !== 'pending');

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-2xl font-bold">House Call Network</h2>
        <span className="text-sm text-medical/60">
          {formatPrice(data.program.revenue)} attributed revenue · {formatPrice(data.program.commissions)} commissions earned
        </span>
        <button className="btn-gold ml-auto !px-4 !py-2 !text-sm" disabled={busy} onClick={releasePayouts}>
          💸 Release payouts
        </button>
      </div>
      {message && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{message}</p>}
      {payoutReport && (
        <div className="mt-3 rounded-lg border border-navy-lighter p-3 text-sm">
          <p className="font-bold">
            Payout run: {payoutReport.paid.length} paid, {payoutReport.skipped.length} skipped
          </p>
          {payoutReport.paid.map((p, i) => (
            <p key={i} className="text-rx">✓ {p.email} — {formatPrice(p.amount)} via {p.method}</p>
          ))}
          {payoutReport.skipped.map((sk, i) => (
            <p key={i} className="text-gold">⚠ {sk.email} — {sk.reason}</p>
          ))}
          {payoutReport.paid.length === 0 && payoutReport.skipped.length === 0 && (
            <p className="text-medical/60">Nobody over the $25 floor this run.</p>
          )}
        </div>
      )}

      {/* Applications queue */}
      <h3 className="mt-8 text-xl font-bold">Applications {pending.length > 0 && <span className="text-gold">({pending.length})</span>}</h3>
      {pending.length === 0 ? (
        <p className="mt-2 text-sm text-medical/60">Queue is empty — the AI is handling the clear-cut ones.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {pending.map((a) => (
            <div key={a.id} className="rounded-xl border-2 border-gold/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <strong className="text-gold">{a.name}</strong>
                <span className="text-sm text-medical/60">{a.email} {a.handle && `· ${a.handle}`}</span>
                {a.aiScore !== null && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${a.aiScore >= 75 ? 'bg-rx/20 text-rx' : a.aiScore <= 30 ? 'bg-red-500/20 text-red-300' : 'bg-gold/20 text-gold'}`}>
                    AI score: {a.aiScore}
                  </span>
                )}
                {a.aiScore === null && <span className="rounded-full bg-navy-lighter px-2 py-0.5 text-xs text-medical/60">AI unavailable — human call</span>}
              </div>
              {a.aiReasoning && <p className="mt-1 text-sm italic text-medical/70">"{a.aiReasoning}"</p>}
              <p className="mt-2 text-sm"><strong>Audience:</strong> {a.audience}</p>
              <p className="mt-1 text-sm"><strong>Pitch:</strong> {a.pitch}</p>
              <p className="mt-1 text-sm text-medical/60">{a.links.map((l, i) => (
                <a key={i} className="mr-3 text-rx underline" href={l} target="_blank" rel="noreferrer">{l}</a>
              ))}</p>
              <div className="mt-3 flex gap-2">
                <button className="btn-rx !px-4 !py-1.5 !text-sm" disabled={busy} onClick={() => decide(a.id, 'approve')}>Approve</button>
                <button className="rounded-lg border border-red-400/40 px-4 py-1.5 text-sm font-bold text-red-300" disabled={busy} onClick={() => decide(a.id, 'reject')}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Roster */}
      <h3 className="mt-10 text-xl font-bold">Roster</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border-2 border-navy-lighter">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-navy-light uppercase tracking-wide text-medical/60">
            <tr>
              <th className="p-3">Affiliate</th>
              <th className="p-3">Status</th>
              <th className="p-3">Tier</th>
              <th className="p-3 text-right">Clicks 30d</th>
              <th className="p-3 text-right">Orders</th>
              <th className="p-3 text-right">Revenue</th>
              <th className="p-3 text-right">Payable</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-lighter">
            {roster.map((a) => (
              <tr key={a.id} className={a.flags.length > 0 ? 'bg-red-500/5' : ''}>
                <td className="p-3">
                  <span className="font-bold text-gold">{a.name}</span>
                  <span className="block text-xs text-medical/60">{a.email} · code {a.code ?? '—'}{a.code && !a.codeSynced && ' (syncing…)'}</span>
                  {a.flags.map((f, i) => <span key={i} className="block text-xs font-bold text-red-300">⚑ {f}</span>)}
                </td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[a.status]}`}>{a.status}</span></td>
                <td className="p-3">{a.tierName}{a.probation && <span className="block text-xs text-medical/60">probation</span>}</td>
                <td className="p-3 text-right">{a.clicks30d}</td>
                <td className="p-3 text-right">{a.conversions}</td>
                <td className="p-3 text-right">{formatPrice(a.attributedRevenue)}</td>
                <td className="p-3 text-right font-bold">{formatPrice(a.balances.cleared)}</td>
                <td className="p-3">
                  <span className="flex flex-wrap gap-1">
                    {a.status === 'approved' && (
                      <button className="btn-outline !px-2 !py-0.5 !text-xs" disabled={busy} onClick={() => decide(a.id, 'pause')}>Pause</button>
                    )}
                    {(a.status === 'paused' || a.status === 'rejected') && (
                      <button className="btn-rx !px-2 !py-0.5 !text-xs" disabled={busy} onClick={() => decide(a.id, a.status === 'paused' ? 'reactivate' : 'approve')}>
                        {a.status === 'paused' ? 'Reactivate' : 'Approve'}
                      </button>
                    )}
                    {a.status !== 'banned' && (
                      <button className="rounded border border-red-400/40 px-2 py-0.5 text-xs font-bold text-red-300" disabled={busy} onClick={() => decide(a.id, 'ban')}>Ban</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {roster.length === 0 && (
              <tr><td className="p-6 text-center text-medical/60" colSpan={8}>No affiliates yet — share flavordoctors.com/affiliates.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
