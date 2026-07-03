import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Product } from '../lib/types';
import { formatPrice } from '../lib/types';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  suggested?: Product[];
}

const CONSULT_OPENER: ChatEntry = {
  role: 'assistant',
  content: "Pharmacy window's open. Describe your symptoms — \"dinner is boring,\" \"chicken again,\" \"my fries deserve better\" — and I'll prescribe something.",
};
const SUPPORT_OPENER: ChatEntry = {
  role: 'assistant',
  content: 'Front Desk here. Questions about an order, shipping, your Rx Box, storage, or billing? Ask away — and if I can’t fix it, I’ll page a human.',
};

/** The clinic window: Flavor Consult (recommendations) + Front Desk (support). */
export function Pharmacist() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'consult' | 'support'>('consult');
  const [consult, setConsult] = useState<ChatEntry[]>([CONSULT_OPENER]);
  const [support, setSupport] = useState<ChatEntry[]>([SUPPORT_OPENER]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [escalation, setEscalation] = useState<null | { email: string; message: string; sent: boolean; error?: string }>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cart = useCart();
  const { user } = useAuth();

  const entries = tab === 'consult' ? consult : support;
  const setEntries = tab === 'consult' ? setConsult : setSupport;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [consult, support, open, tab, escalation]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatEntry[] = [...entries, { role: 'user', content: text }];
    setEntries(next);
    setInput('');
    setBusy(true);
    try {
      if (tab === 'consult') {
        const res = await api.post<{ reply: string; suggested: Product[] }>('/api/pharmacist', {
          messages: next.filter((e) => e !== CONSULT_OPENER).map((e) => ({ role: e.role, content: e.content })),
        });
        setConsult([...next, { role: 'assistant', content: res.reply, suggested: res.suggested }]);
      } else {
        const res = await api.post<{ reply: string; escalate: boolean; signedInEmail: string | null }>('/api/support', {
          messages: next.filter((e) => e !== SUPPORT_OPENER).map((e) => ({ role: e.role, content: e.content })),
        });
        setSupport([...next, { role: 'assistant', content: res.reply }]);
        if (res.escalate) {
          setEscalation({ email: res.signedInEmail ?? user?.email ?? '', message: text, sent: false });
        }
      }
    } catch {
      setEntries([...next, { role: 'assistant', content: tab === 'consult' ? 'The Pharmacist is with another patient — please try again in a moment.' : 'The desk hit a snag — try again, or leave a message below.' }]);
      if (tab === 'support') setEscalation({ email: user?.email ?? '', message: text, sent: false });
    } finally {
      setBusy(false);
    }
  };

  const submitTicket = async () => {
    if (!escalation) return;
    setBusy(true);
    try {
      const transcript = support
        .filter((e) => e !== SUPPORT_OPENER)
        .map((e) => `${e.role === 'user' ? 'Customer' : 'Bot'}: ${e.content}`)
        .join('\n');
      await api.post('/api/support/ticket', {
        email: escalation.email,
        subject: escalation.message.slice(0, 120),
        message: escalation.message,
        transcript,
      });
      setEscalation({ ...escalation, sent: true });
    } catch (e) {
      setEscalation({ ...escalation, error: e instanceof Error ? e.message : 'Could not open the ticket' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-rx px-5 py-3 font-extrabold text-navy shadow-xl transition-transform hover:scale-105"
      >
        💊 {open ? 'Close' : 'Ask the Clinic'}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[30rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border-2 border-navy-lighter bg-navy shadow-2xl">
          <div className="border-b border-navy-lighter bg-navy-light px-4 pt-3">
            <div className="flex gap-2">
              <button
                className={`rounded-t-lg px-3 py-2 text-sm font-bold ${tab === 'consult' ? 'bg-navy text-rx' : 'text-medical/60'}`}
                onClick={() => setTab('consult')}
              >
                💊 Flavor Consult
              </button>
              <button
                className={`rounded-t-lg px-3 py-2 text-sm font-bold ${tab === 'support' ? 'bg-navy text-rx' : 'text-medical/60'}`}
                onClick={() => setTab('support')}
              >
                🩺 Front Desk
              </button>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {entries.map((e, i) => (
              <div key={i}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    e.role === 'user' ? 'ml-auto bg-rx text-navy' : 'bg-navy-light text-medical'
                  }`}
                >
                  {e.content}
                </div>
                {e.suggested && e.suggested.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {e.suggested.map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-navy-lighter bg-navy-light px-3 py-2 text-sm">
                        <Link to={`/product/${p.slug}`} className="font-bold text-gold hover:underline" onClick={() => setOpen(false)}>
                          {p.name}
                        </Link>
                        <div className="flex items-center gap-2">
                          <span className="text-medical/60">{formatPrice(p.price)}</span>
                          <button className="rounded bg-rx px-2 py-1 text-xs font-bold text-navy" onClick={() => cart.add(p)}>
                            + Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="text-sm text-medical/60">{tab === 'consult' ? 'Checking the formulary…' : 'Checking your chart…'}</p>}

            {tab === 'support' && escalation && !escalation.sent && (
              <div className="rounded-xl border border-gold/50 bg-navy-light p-3">
                <p className="text-sm font-bold text-gold">Open a ticket for a human</p>
                <input
                  className="input mt-2 !py-2 !text-sm"
                  type="email"
                  placeholder="you@example.com"
                  value={escalation.email}
                  onChange={(e) => setEscalation({ ...escalation, email: e.target.value })}
                />
                {escalation.error && <p className="mt-1 text-xs text-red-300">{escalation.error}</p>}
                <button className="btn-gold mt-2 w-full !py-2 !text-sm" disabled={busy || !escalation.email.includes('@')} onClick={submitTicket}>
                  Page the Doctor (create ticket)
                </button>
              </div>
            )}
            {tab === 'support' && escalation?.sent && (
              <p className="rounded-xl bg-rx/10 p-3 text-sm font-bold text-rx">
                Ticket opened — check your inbox for confirmation. A human will reply soon. 🩺
              </p>
            )}
          </div>
          <div className="flex gap-2 border-t border-navy-lighter p-3">
            <input
              className="input !py-2 !text-sm"
              placeholder={tab === 'consult' ? 'Describe your symptoms…' : 'Ask about orders, shipping, billing…'}
              value={input}
              maxLength={600}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button className="btn-rx shrink-0 !px-4 !py-2 !text-sm" onClick={send} disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
