import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Product } from '../lib/types';
import { formatPrice } from '../lib/types';
import { useCart } from '../context/CartContext';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  suggested?: Product[];
}

const OPENER: ChatEntry = {
  role: 'assistant',
  content: "Pharmacy window's open. Describe your symptoms — \"dinner is boring,\" \"chicken again,\" \"my fries deserve better\" — and I'll prescribe something.",
};

/** The Pharmacist: floating AI flavor-consult widget. */
export function Pharmacist() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([OPENER]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cart = useCart();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatEntry[] = [...entries, { role: 'user', content: text }];
    setEntries(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api.post<{ reply: string; suggested: Product[] }>('/api/pharmacist', {
        messages: next.filter((e) => e !== OPENER).map((e) => ({ role: e.role, content: e.content })),
      });
      setEntries([...next, { role: 'assistant', content: res.reply, suggested: res.suggested }]);
    } catch {
      setEntries([...next, { role: 'assistant', content: 'The Pharmacist is with another patient — please try again in a moment.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-rx px-5 py-3 font-extrabold text-navy shadow-xl transition-transform hover:scale-105"
        aria-label="Ask The Pharmacist"
      >
        💊 {open ? 'Close' : 'Ask The Pharmacist'}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border-2 border-navy-lighter bg-navy shadow-2xl">
          <div className="border-b border-navy-lighter bg-navy-light px-4 py-3">
            <p className="font-heading text-lg font-bold">The Pharmacist 🩺</p>
            <p className="text-xs text-medical/60">AI flavor consult — not actual medicine</p>
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
            {busy && <p className="text-sm text-medical/60">Checking the formulary…</p>}
          </div>
          <div className="flex gap-2 border-t border-navy-lighter p-3">
            <input
              className="input !py-2 !text-sm"
              placeholder="Describe your symptoms…"
              value={input}
              maxLength={500}
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
