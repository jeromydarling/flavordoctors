import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';
import { DraftsPanel } from './DraftsPanel';

interface Campaign {
  id: string; name: string; segment: string; subject: string; subject_b: string | null;
  status: string; sent_count: number; created_at: string;
  stats: { sent?: number; open?: number; click?: number };
}
interface Flow {
  key: string; name: string; enabled: number; trigger: string; delay_days: number; subject: string; body_html: string;
}
interface PendingReview { id: number; rating: number; body: string; product_name: string; email: string }

export function AdminMarketing() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [segments, setSegments] = useState<{ key: string; name: string }[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [contacts, setContacts] = useState<{ total?: number; consented?: number; waitlist?: number; referred?: number } | null>(null);
  const [form, setForm] = useState({ name: '', segment: 'all_contacts', subject: '', subjectB: '', bodyHtml: '', brief: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api.get<{ campaigns: Campaign[]; segments: { key: string; name: string }[] }>('/api/admin/marketing/campaigns').then((d) => {
        setCampaigns(d.campaigns);
        setSegments(d.segments);
      }),
      api.get<{ flows: Flow[] }>('/api/admin/marketing/flows').then((d) => setFlows(d.flows)),
      api.get<{ reviews: PendingReview[] }>('/api/admin/marketing/reviews/pending').then((d) => setReviews(d.reviews)),
      api.get<{ totals: typeof contacts }>('/api/admin/marketing/contacts').then((d) => setContacts(d.totals)),
    ]);

  useEffect(() => {
    load().catch(() => setCampaigns([]));
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage(okMsg);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const draft = () =>
    run('draft', async () => {
      const d = await api.post<{ subject: string; subjectB: string; bodyHtml: string }>('/api/admin/marketing/campaigns/draft', { brief: form.brief });
      setForm((f) => ({ ...f, subject: d.subject, subjectB: d.subjectB, bodyHtml: d.bodyHtml }));
    }, 'Draft ready — review below.');

  if (campaigns === null)
    return (
      <div className="mx-auto max-w-6xl px-4 py-12"><AdminNav /><PageSpinner /></div>
    );

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      {message && <p className="mb-4 rounded bg-rx/10 p-3 font-semibold text-rx">{message}</p>}

      <DraftsPanel />

      {/* Contacts */}
      <div className="flex flex-wrap gap-4">
        {[
          ['Contacts', contacts?.total], ['Consented', contacts?.consented],
          ['Waitlist', contacts?.waitlist], ['Referred', contacts?.referred],
        ].map(([label, n]) => (
          <div key={String(label)} className="rx-card !p-4 !py-3">
            <span className="text-sm text-medical/60">{label}: </span>
            <span className="text-xl font-black text-gold">{n ?? 0}</span>
          </div>
        ))}
        <a href="/api/admin/marketing/contacts.csv" className="btn-outline !py-2 !text-sm">⬇ Export CSV</a>
      </div>

      {/* Campaign composer */}
      <h2 className="mt-10 text-2xl font-bold">New Campaign</h2>
      <div className="rx-card mt-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input className="input !w-64" placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input !w-64" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
            {segments.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <input className="input" placeholder="Brief for the AI copywriter, e.g. 'Labor Day sale, 20% off, code GRILLRX'" value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} />
          <button className="btn-gold shrink-0 !py-2 !text-sm" onClick={draft} disabled={busy !== null || !form.brief.trim()}>
            {busy === 'draft' ? 'Writing…' : '✦ AI Draft'}
          </button>
        </div>
        <input className="input" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <input className="input" placeholder="Subject B (optional A/B variant)" value={form.subjectB} onChange={(e) => setForm({ ...form, subjectB: e.target.value })} />
        <textarea className="input font-mono !text-sm" rows={7} placeholder="Body HTML (h2/p/strong/a). {{SITE_URL}} and {{REF_CODE}} are substituted per recipient." value={form.bodyHtml} onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })} />
        <button
          className="btn-rx !py-2 !text-base"
          disabled={busy !== null || !form.name.trim() || !form.subject.trim() || !form.bodyHtml.trim()}
          onClick={() => run('create', () => api.post('/api/admin/marketing/campaigns', form), 'Campaign saved as draft.')}
        >
          Save Draft
        </button>
      </div>

      {/* Campaign list */}
      <h2 className="mt-10 text-2xl font-bold">Campaigns</h2>
      <div className="mt-4 space-y-3">
        {campaigns.length === 0 && <p className="text-medical/60">No campaigns yet.</p>}
        {campaigns.map((c) => (
          <div key={c.id} className="rx-card !p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold">{c.name} <span className="ml-2 rounded-full bg-navy-lighter px-2 py-0.5 text-xs">{c.segment}</span></p>
                <p className="text-sm text-medical/60">“{c.subject}”{c.subject_b ? ` / B: “${c.subject_b}”` : ''}</p>
                {c.status === 'sent' && (
                  <p className="mt-1 text-sm text-rx">
                    Sent {c.sent_count} · Opens {c.stats.open ?? 0} · Clicks {c.stats.click ?? 0}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-outline !px-3 !py-1 !text-sm" disabled={busy !== null}
                  onClick={() => run(`test-${c.id}`, () => api.post(`/api/admin/marketing/campaigns/${c.id}/test`), 'Test sent to your inbox.')}>
                  Test → me
                </button>
                {c.status !== 'sent' && (
                  <button className="btn-rx !px-3 !py-1 !text-sm" disabled={busy !== null}
                    onClick={() => window.confirm(`Send "${c.name}" to segment "${c.segment}" now?`) &&
                      run(`send-${c.id}`, () => api.post(`/api/admin/marketing/campaigns/${c.id}/send`), 'Campaign sent!')}>
                    {busy === `send-${c.id}` ? 'Sending…' : 'Send'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Flows */}
      <h2 className="mt-10 text-2xl font-bold">Lifecycle Flows</h2>
      <div className="mt-4 space-y-3">
        {flows.map((f) => (
          <FlowEditor key={f.key} flow={f} onSaved={() => run(`flow-${f.key}`, load, 'Flow updated.')} />
        ))}
      </div>

      {/* Review moderation */}
      <h2 className="mt-10 text-2xl font-bold">Pending Reviews ({reviews.length})</h2>
      <div className="mt-4 space-y-3">
        {reviews.length === 0 && <p className="text-medical/60">Nothing awaiting moderation.</p>}
        {reviews.map((r) => (
          <div key={r.id} className="rx-card !p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold">{r.product_name} — {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} <span className="text-sm text-medical/60">({r.email})</span></p>
              <p className="text-medical/80">{r.body}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-rx !px-3 !py-1 !text-sm" onClick={() => run(`rev-${r.id}`, () => api.post(`/api/admin/marketing/reviews/${r.id}`, { action: 'approve' }), 'Review approved.')}>Approve</button>
              <button className="btn-outline !px-3 !py-1 !text-sm" onClick={() => run(`revd-${r.id}`, () => api.post(`/api/admin/marketing/reviews/${r.id}`, { action: 'delete' }), 'Review deleted.')}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowEditor({ flow, onSaved }: { flow: Flow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(flow.subject);
  const [body, setBody] = useState(flow.body_html);
  const [delay, setDelay] = useState(String(flow.delay_days));

  const save = async (enabled?: boolean) => {
    await api.put(`/api/admin/marketing/flows/${flow.key}`, {
      subject, bodyHtml: body, delayDays: parseInt(delay, 10),
      enabled: enabled ?? flow.enabled === 1,
    });
    onSaved();
  };

  return (
    <div className="rx-card !p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold">{flow.name}</p>
          <p className="text-sm text-medical/60">{flow.trigger} + {flow.delay_days}d · “{flow.subject}”</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={`rounded-full px-3 py-1 text-xs font-bold ${flow.enabled ? 'bg-rx/20 text-rx' : 'bg-medical/10 text-medical/60'}`} onClick={() => save(flow.enabled !== 1)}>
            {flow.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button className="btn-outline !px-3 !py-1 !text-sm" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit'}</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <input className="input !w-24" type="number" min="0" value={delay} onChange={(e) => setDelay(e.target.value)} title="Delay days" />
          </div>
          <textarea className="input font-mono !text-sm" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-rx !px-4 !py-1 !text-sm" onClick={() => save()}>Save Flow</button>
        </div>
      )}
    </div>
  );
}
