import { api } from './api';

const KEY = 'fd_aff';
const WINDOW_MS = 30 * 86400000; // 30-day attribution window

/** Store an ?aff= link ref and fire the click beacon (once per capture). */
export function captureAffRef(ref: string): void {
  if (!/^hc_[a-z0-9]{1,40}$/.test(ref)) return;
  localStorage.setItem(KEY, JSON.stringify({ ref, exp: Date.now() + WINDOW_MS }));
  api.post('/api/aff/click', { ref }).catch(() => {});
}

/** The unexpired affiliate ref to attach to checkouts, if any. */
export function affRef(): string | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { ref: string; exp: number } | null;
    if (stored && stored.exp > Date.now()) return stored.ref;
  } catch {
    // Corrupted storage — treat as no ref.
  }
  return undefined;
}
