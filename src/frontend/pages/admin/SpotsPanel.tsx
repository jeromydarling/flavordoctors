import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';

interface Spot {
  id: string;
  product_id: string | null;
  product_name: string | null;
  brief: string;
  motion_prompt: string | null;
  duration: number;
  status: string;
  r2_key: string | null;
  voiceover_r2_key: string | null;
  music_r2_key: string | null;
  error: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  drafting: 'Draft — review the motion prompt, then submit',
  generating: 'Generating at Higgsfield…',
  importing: 'Importing into your R2…',
  ready: 'Ready',
  failed: 'Failed',
};

/** AI video spots: brief → motion prompt → Higgsfield render → R2. Drafts never auto-publish. */
export function SpotsPanel() {
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [configured, setConfigured] = useState({ higgsfield: true, elevenlabs: true });
  const [brief, setBrief] = useState('');
  const [productId, setProductId] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioOpen, setAudioOpen] = useState<string | null>(null);
  const [audio, setAudio] = useState({ voiceoverText: '', musicPrompt: '' });

  const load = useCallback(async () => {
    const d = await api
      .get<{ spots: Spot[]; configured: { higgsfield: boolean; elevenlabs: boolean } }>('/api/admin/marketing/spots')
      .catch(() => null);
    if (d) {
      setSpots(d.spots);
      setConfigured(d.configured);
    }
  }, []);
  useEffect(() => {
    load();
    api
      .get<{ products: { id: string; name: string }[] }>('/api/admin/products')
      .then((d) => setProducts(d.products))
      .catch(() => {});
  }, [load]);

  const act = async (fn: () => Promise<unknown>, okNote: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote(okNote);
      await load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-12">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-black">Video spots</h2>
          <p className="text-sm text-medical/60">
            Brief → AI motion prompt → your real product photo animated into a short spot, delivered to your own storage.
          </p>
        </div>
        <button className="rounded bg-navy-light px-3 py-1.5 text-sm font-bold text-medical/70" disabled={busy}
          onClick={() => act(() => api.post('/api/admin/marketing/spots/poll'), 'Checked generation status.')}>
          Refresh status
        </button>
      </div>

      {!configured.higgsfield && (
        <p className="mt-3 rounded border border-gold/40 bg-gold/10 p-3 text-sm text-gold">
          Drafting works now; <strong>generation is off</strong> until the <code>HIGGSFIELD_KEY</code> / <code>HIGGSFIELD_SECRET</code> secrets are set
          (and the Higgsfield API wallet is funded). Prompts you draft here submit with one click once configured.
        </p>
      )}
      {note && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{note}</p>}

      <div className="mt-4 rx-card !p-4">
        <div className="flex flex-wrap gap-2">
          <input aria-label="Spot brief" className="input flex-1 !py-1.5 !text-sm" placeholder='Brief, e.g. "launch the harissa honey drop — moody, appetizing, autumn"'
            value={brief} onChange={(e) => setBrief(e.target.value)} />
          <select aria-label="Product" className="input !w-56 !py-1.5 !text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Pick a product (its photo is animated)</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn-rx !py-1.5 !text-sm" disabled={busy || !brief.trim() || !productId}
            onClick={() => act(() => api.post('/api/admin/marketing/spots', { brief, productId }), 'Spot drafted — review the prompt below.').then(() => { setBrief(''); })}>
            Draft spot
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {spots.length === 0 && <p className="text-sm text-medical/50">No spots yet.</p>}
        {spots.map((s) => (
          <div key={s.id} className="rx-card !p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold">{s.product_name ?? 'Untitled'} spot</span>
                <span className="ml-2 text-xs text-medical/50">{STATUS_LABELS[s.status] ?? s.status}</span>
                {s.error && <span className="ml-2 text-xs text-red-300">{s.error}</span>}
              </div>
              <div className="flex gap-2 text-sm">
                {['drafting', 'failed'].includes(s.status) && (
                  <button className="font-bold text-rx underline" disabled={busy}
                    onClick={() => act(() => api.post(`/api/admin/marketing/spots/${s.id}/submit`), 'Submitted — generation takes a few minutes.')}>
                    Generate video
                  </button>
                )}
                <button className="font-bold text-gold underline" onClick={() => setAudioOpen(audioOpen === s.id ? null : s.id)}>
                  Audio
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-medical/50">Brief: {s.brief}</p>

            {['drafting', 'failed'].includes(s.status) && (
              <textarea aria-label={`Motion prompt for ${s.id}`} className="input mt-2 !text-sm" rows={3} value={s.motion_prompt ?? ''}
                onChange={(e) => setSpots(spots.map((x) => (x.id === s.id ? { ...x, motion_prompt: e.target.value } : x)))}
                onBlur={() => api.put(`/api/admin/marketing/spots/${s.id}`, { motionPrompt: s.motion_prompt }).catch(() => {})} />
            )}

            {s.status === 'ready' && s.r2_key && (
              <video className="mt-3 w-full max-w-md rounded-lg border border-navy-lighter" controls preload="metadata"
                src={`/${s.r2_key.replace(/^cdn\//, 'cdn/')}`} />
            )}
            {(s.voiceover_r2_key || s.music_r2_key) && (
              <p className="mt-2 space-x-3 text-sm">
                {s.voiceover_r2_key && <a className="text-rx underline" href={`/${s.voiceover_r2_key}`}>Voiceover.mp3</a>}
                {s.music_r2_key && <a className="text-rx underline" href={`/${s.music_r2_key}`}>Music.mp3</a>}
              </p>
            )}

            {audioOpen === s.id && (
              <div className="mt-3 rounded-lg bg-navy-light/60 p-3">
                {!configured.elevenlabs && (
                  <p className="mb-2 text-xs text-gold">ElevenLabs is not configured — set the <code>ELEVENLABS_API_KEY</code> secret to generate audio.</p>
                )}
                <input aria-label="Voiceover text" className="input !py-1.5 !text-sm" placeholder="Voiceover line (Brian reads it)"
                  value={audio.voiceoverText} onChange={(e) => setAudio({ ...audio, voiceoverText: e.target.value })} />
                <input aria-label="Music prompt" className="input mt-2 !py-1.5 !text-sm" placeholder="Music prompt (optional)"
                  value={audio.musicPrompt} onChange={(e) => setAudio({ ...audio, musicPrompt: e.target.value })} />
                <button className="btn-rx mt-2 !py-1.5 !text-sm" disabled={busy}
                  onClick={() => act(() => api.post(`/api/admin/marketing/spots/${s.id}/audio`, audio), 'Audio generated into R2.').then(() => setAudio({ voiceoverText: '', musicPrompt: '' }))}>
                  Generate audio
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
