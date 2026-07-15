import type { Env } from '../types';

/**
 * Brand identity as data: one source of truth that renders into every email,
 * export, and AI prompt. Code-level defaults ARE the current Flavor Doctors
 * brand, so an empty table changes nothing; brand_settings rows override.
 */
export interface Brand {
  name: string;
  tagline: string;
  /** Written voice description — steers all AI-generated copy. */
  voice: string;
  colors: { primary: string; accent: string; ink: string; bg: string };
  /** Optional hosted logo image; the wordmark renders when absent. */
  logoUrl: string | null;
  postalAddress: string;
  replyTo: string;
}

export const BRAND_DEFAULTS: Brand = {
  name: 'Flavor Doctors',
  tagline: 'Prescription-strength flavor. Small-batch sauces & seasonings.',
  voice:
    'Deadpan medical satire delivered with total sincerity: diagnoses, prescriptions, and treatments for chronic blandness. Warm, confident, never winking at the camera. Short punchy sentences. Puns are welcome when they are earned. Always honest about the product — real ingredients, real scarcity, no hype.',
  colors: { primary: '#0D1B2A', accent: '#2ECC71', ink: '#1B2733', bg: '#F4F1EA' },
  logoUrl: null,
  postalAddress: 'Flavor Doctors · New Prague, MN, USA',
  replyTo: 'orders@flavordoctors.com',
};

const JSON_KEYS = new Set(['colors']);

export async function getBrand(env: Env): Promise<Brand> {
  const { results } = await env.DB.prepare('SELECT key, value FROM brand_settings').all<{ key: string; value: string }>();
  const brand: Brand = { ...BRAND_DEFAULTS, colors: { ...BRAND_DEFAULTS.colors } };
  for (const row of results) {
    try {
      const v = JSON_KEYS.has(row.key) ? JSON.parse(row.value) : row.value;
      if (row.key === 'colors' && typeof v === 'object' && v) brand.colors = { ...brand.colors, ...v };
      else if (row.key in brand) (brand as unknown as Record<string, unknown>)[row.key] = v === '' ? null : v;
    } catch {
      // a malformed row must never take email sending down
    }
  }
  return brand;
}

export async function saveBrand(env: Env, patch: Partial<Brand>): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => k in BRAND_DEFAULTS);
  for (const [key, value] of entries) {
    const stored = JSON_KEYS.has(key) ? JSON.stringify(value) : String(value ?? '');
    await env.DB.prepare(
      "INSERT INTO brand_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
      .bind(key, stored)
      .run();
  }
}
