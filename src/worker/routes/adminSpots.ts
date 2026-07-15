import { json, readJson, errorResponse } from '../lib/util';
import { requireAdmin } from '../lib/auth';
import type { ProductRow } from '../types';
import {
  createSpot,
  submitSpot,
  pollSpots,
  generateSpotAudio,
  higgsfieldConfigured,
  elevenlabsConfigured,
} from '../lib/videoSpots';

export const listSpots = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    `SELECT s.*, p.name AS product_name FROM mkt_spots s
     LEFT JOIN products p ON p.id = s.product_id
     ORDER BY s.created_at DESC LIMIT 50`
  ).all();
  return json({
    spots: results,
    configured: { higgsfield: higgsfieldConfigured(rc.env), elevenlabs: elevenlabsConfigured(rc.env) },
  });
});

export const createSpotRoute = requireAdmin(async (req, rc) => {
  const body = await readJson<{ brief?: string; productId?: string }>(req);
  if (!body?.brief?.trim()) return errorResponse('brief is required');
  let product: ProductRow | null = null;
  if (body.productId) {
    product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(body.productId).first<ProductRow>();
    if (!product) return errorResponse('Product not found', 404);
  }
  const id = await createSpot(rc.env, body.brief.trim(), product);
  return json({ id }, 201);
});

export const updateSpot = requireAdmin(async (req, rc) => {
  const body = await readJson<{ motionPrompt?: string; duration?: number }>(req);
  if (!body) return errorResponse('Invalid JSON body');
  const existing = await rc.env.DB.prepare('SELECT id, status FROM mkt_spots WHERE id = ?').bind(rc.params.id).first<{ id: string; status: string }>();
  if (!existing) return errorResponse('Spot not found', 404);
  if (!['drafting', 'failed'].includes(existing.status)) return errorResponse('Only drafting/failed spots are editable');
  if (body.duration !== undefined && ![5, 10].includes(body.duration)) return errorResponse('duration must be 5 or 10');
  await rc.env.DB.prepare(
    "UPDATE mkt_spots SET motion_prompt = COALESCE(?, motion_prompt), duration = COALESCE(?, duration), updated_at = datetime('now') WHERE id = ?"
  )
    .bind(body.motionPrompt?.trim() ?? null, body.duration ?? null, rc.params.id)
    .run();
  return json({ ok: true });
});

export const submitSpotRoute = requireAdmin(async (req, rc) => {
  const err = await submitSpot(rc.env, rc.params.id, new URL(req.url).origin.replace('http://127.0.0.1:8791', 'https://flavordoctors.com'));
  if (err) return errorResponse(err, err.includes('not configured') ? 503 : 400);
  return json({ ok: true });
});

export const spotAudioRoute = requireAdmin(async (req, rc) => {
  const body = await readJson<{ voiceoverText?: string; musicPrompt?: string }>(req);
  if (!body?.voiceoverText?.trim() && !body?.musicPrompt?.trim()) {
    return errorResponse('Provide voiceoverText and/or musicPrompt');
  }
  const err = await generateSpotAudio(rc.env, rc.params.id, body);
  if (err) return errorResponse(err, err.includes('not configured') ? 503 : 400);
  return json({ ok: true });
});

export const pollSpotsRoute = requireAdmin(async (_req, rc) => {
  await pollSpots(rc.env);
  return json({ ok: true });
});
