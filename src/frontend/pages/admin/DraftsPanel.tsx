import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';

interface KitContent {
  instagram: string;
  tweet: string;
  email_md: string;
  blurb: string;
}
interface Draft {
  id: string;
  kind: string;
  title: string;
  status: string;
  product_name: string | null;
  created_at: string;
  content: KitContent;
}

const FIELD_LABELS: Record<keyof KitContent, string> = {
  instagram: 'Instagram caption',
  tweet: 'Tweet',
  email_md: 'Email section (markdown)',
  blurb: 'One-line blurb',
};

/** Auto-drafted content kits from product events. Drafts only — nothing posts itself. */
export function DraftsPanel() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<{ drafts: Draft[] }>('/api/admin/marketing/drafts').catch(() => ({ drafts: [] }));
    setDrafts(d.drafts);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const generateNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<{ drafted: number }>('/api/admin/marketing/drafts/process');
      setNote(r.drafted > 0 ? `${r.drafted} new draft${r.drafted === 1 ? '' : 's'} generated.` : 'No pending product events.');
      await load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const save = async (draft: Draft) => {
    await api.put(`/api/admin/marketing/drafts/${draft.id}`, { content: draft.content });
    setNote('Draft saved.');
    await load();
  };
  const archive = async (id: string) => {
    await api.put(`/api/admin/marketing/drafts/${id}`, { status: 'archived' });
    await load();
  };
  const toCampaign = async (id: string) => {
    const r = await api.post<{ campaignId: string }>(`/api/admin/marketing/drafts/${id}/to-campaign`);
    setNote(`Loaded into the composer as campaign ${r.campaignId} — scroll to Campaigns to edit and send.`);
    await load();
  };

  return (
    <div className="mt-12">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-black">Auto-drafted kits</h2>
          <p className="text-sm text-medical/60">
            When products publish, drop, restock, or run low, launch kits draft themselves here. Everything is editable; nothing posts itself.
          </p>
        </div>
        <button className="btn-rx !py-2" onClick={generateNow} disabled={busy}>
          {busy ? 'Generating…' : 'Generate now'}
        </button>
      </div>
      {note && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{note}</p>}

      {drafts.length === 0 && <p className="mt-4 text-sm text-medical/50">No drafts yet — publish a product and they'll appear.</p>}
      <div className="mt-4 space-y-3">
        {drafts.map((d) => (
          <div key={d.id} className="rx-card !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {d.status === 'new' && <span className="mr-2 rounded-full bg-gold/20 px-2 py-0.5 text-xs font-bold text-gold">NEW</span>}
                <span className="font-bold">{d.title}</span>
                <span className="ml-2 text-xs text-medical/50">{d.kind.replace(/_/g, ' ')} · {d.status}</span>
              </div>
              <div className="flex gap-2 text-sm">
                <button className="font-bold text-rx underline" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {open === d.id ? 'Close' : 'Review & edit'}
                </button>
                <button className="font-bold text-gold underline" onClick={() => toCampaign(d.id)}>To composer</button>
                <button className="text-medical/50 underline" onClick={() => archive(d.id)}>Archive</button>
              </div>
            </div>
            {open === d.id && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(Object.keys(FIELD_LABELS) as (keyof KitContent)[]).map((k) => (
                  <div key={k}>
                    <label className="block text-xs font-bold uppercase tracking-wide text-medical/60" htmlFor={`draft-${d.id}-${k}`}>
                      {FIELD_LABELS[k]}
                    </label>
                    <textarea
                      id={`draft-${d.id}-${k}`}
                      className="input mt-1 !text-sm"
                      rows={k === 'email_md' ? 5 : 3}
                      value={d.content[k]}
                      onChange={(e) =>
                        setDrafts(drafts.map((x) => (x.id === d.id ? { ...x, content: { ...x.content, [k]: e.target.value } } : x)))
                      }
                    />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <button className="btn-rx !py-2" onClick={() => save(d)}>Save edits</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
