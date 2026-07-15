import type { Env, ProductRow } from '../types';
import { runChatLogged } from './ai';
import { getBrand } from './brand';
import { newId } from './util';

/**
 * Video-spot connector: turn a brief + product into a short generated video.
 *
 * Pipeline: AI drafts an editable motion prompt (brand voice, grounded in the
 * product record) → Higgsfield platform API animates the REAL product photo
 * (image-to-video) → the finished clip is pulled into R2 by the existing
 * media-import cron → previewable/downloadable in the Marketing studio.
 * ElevenLabs generates optional voiceover/music as separate audio assets
 * (Workers can't run ffmpeg, so muxing multi-track spots stays out of scope).
 *
 * Everything degrades cleanly: without HIGGSFIELD_KEY/SECRET the studio still
 * drafts and stores prompts; submission returns an honest "not configured".
 */

const HF_BASE = 'https://platform.higgsfield.ai';
const DEFAULT_MODEL = 'kling-video/v2.5-turbo/pro/image-to-video';
const EL_BASE = 'https://api.elevenlabs.io';
const EL_VOICE_DEFAULT = 'nPczCjzI2devNBz1zQrb'; // Brian — the brand's promo voice

export function higgsfieldConfigured(env: Env): boolean {
  return Boolean(env.HIGGSFIELD_KEY && env.HIGGSFIELD_SECRET);
}
export function elevenlabsConfigured(env: Env): boolean {
  return Boolean(env.ELEVENLABS_API_KEY);
}

function hfAuth(env: Env): string {
  return `Key ${env.HIGGSFIELD_KEY}:${env.HIGGSFIELD_SECRET}`;
}

async function logUsage(env: Env, provider: string, model: string, operation: string): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO ai_usage (provider, model, operation) VALUES (?, ?, ?)')
      .bind(provider, model, operation)
      .run();
  } catch (err) {
    console.error('ai_usage log failed:', err);
  }
}

/** Draft the motion prompt from the brief + product facts, in brand voice. */
export async function draftMotionPrompt(env: Env, brief: string, product: ProductRow | null): Promise<string> {
  const facts = product
    ? `Product: ${product.name}\nCategory: ${product.collection}\nDescription: ${product.description}\nThe input image is the real product photo (a jar on a styled background).`
    : 'No product attached — describe an abstract brand scene.';
  if (env.AI) {
    try {
      const brand = await getBrand(env);
      const raw = await runChatLogged(
        env,
        'spot_motion_prompt',
        [
          {
            role: 'system',
            content: `You write MOTION PROMPTS for an image-to-video AI that animates a product photo into a 5-10 second social video ad. Brand voice for mood only: ${brand.voice}
Rules: describe camera movement (push-in, orbit, pan), lighting change, atmosphere (steam, particles, glow), and pacing. The product must stay the hero and legible. No text overlays, no humans, no invented product claims. Output ONLY the motion prompt as plain text, max 90 words.`,
          },
          { role: 'user', content: `Creative brief: ${brief}\n\nFACTS:\n${facts}` },
        ],
        300
      );
      if (raw.trim()) return raw.trim();
    } catch (err) {
      console.error('Motion prompt AI draft failed; using template:', err);
    }
  }
  const name = product?.name ?? 'the product';
  return `Slow cinematic push-in on ${name}, warm studio key light sweeping across the jar, gentle steam curling upward, shallow depth of field, dust motes drifting in golden backlight, subtle parallax on the background, ending on a crisp hero framing of the label. Appetizing, premium, calm.`;
}

/** Create a spot row (always succeeds; drafting works without any keys). */
export async function createSpot(env: Env, brief: string, product: ProductRow | null): Promise<string> {
  const id = newId('spot');
  const prompt = await draftMotionPrompt(env, brief, product);
  await env.DB.prepare(
    'INSERT INTO mkt_spots (id, product_id, brief, motion_prompt, duration) VALUES (?, ?, ?, ?, 5)'
  )
    .bind(id, product?.id ?? null, brief, prompt)
    .run();
  return id;
}

/** Submit a drafted spot to Higgsfield. Returns an error string when blocked. */
export async function submitSpot(env: Env, spotId: string, origin: string): Promise<string | null> {
  if (!higgsfieldConfigured(env)) {
    return 'Higgsfield API is not configured — set the HIGGSFIELD_KEY and HIGGSFIELD_SECRET secrets, then submit again.';
  }
  const spot = await env.DB.prepare('SELECT * FROM mkt_spots WHERE id = ?').bind(spotId).first<{
    id: string;
    product_id: string | null;
    motion_prompt: string | null;
    duration: number;
    status: string;
  }>();
  if (!spot) return 'Spot not found';
  if (!['drafting', 'failed'].includes(spot.status)) return `Spot is ${spot.status} — nothing to submit`;
  if (!spot.motion_prompt?.trim()) return 'Write a motion prompt first';
  const product = spot.product_id
    ? await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(spot.product_id).first<ProductRow>()
    : null;
  if (!product?.image_r2_key) return 'Attach a product with a photo — the spot animates the real product image';

  const model = env.HIGGSFIELD_VIDEO_MODEL || DEFAULT_MODEL;
  const res = await fetch(`${HF_BASE}/${model}`, {
    method: 'POST',
    headers: { Authorization: hfAuth(env), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      image_url: `${origin}/images/${product.image_r2_key}`,
      prompt: spot.motion_prompt,
      duration: spot.duration,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { request_id?: string; detail?: unknown };
  if (!res.ok || !data.request_id) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? res.status);
    await env.DB.prepare("UPDATE mkt_spots SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(`Submit failed: ${detail}`, spotId)
      .run();
    return `Higgsfield rejected the job: ${detail}`;
  }
  await logUsage(env, 'higgsfield', model, 'spot_video');
  await env.DB.prepare(
    "UPDATE mkt_spots SET status = 'generating', provider = ?, request_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(model, data.request_id, spotId)
    .run();
  return null;
}

/** Poll generating spots; completed ones are handed to the media-import cron. */
export async function pollSpots(env: Env): Promise<void> {
  if (!higgsfieldConfigured(env)) return;
  const { results } = await env.DB.prepare(
    "SELECT id, request_id FROM mkt_spots WHERE status = 'generating' AND request_id IS NOT NULL LIMIT 10"
  ).all<{ id: string; request_id: string }>();
  for (const spot of results) {
    try {
      const res = await fetch(`${HF_BASE}/requests/${spot.request_id}/status`, {
        headers: { Authorization: hfAuth(env), Accept: 'application/json' },
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        video?: { url?: string };
        detail?: string;
      };
      if (data.status === 'completed' && data.video?.url) {
        const r2Key = `cdn/spots/${spot.id}.mp4`;
        await env.DB.prepare('INSERT OR IGNORE INTO media_imports (url, r2_key) VALUES (?, ?)')
          .bind(data.video.url, r2Key)
          .run();
        await env.DB.prepare(
          "UPDATE mkt_spots SET status = 'importing', video_url = ?, r2_key = ?, updated_at = datetime('now') WHERE id = ?"
        )
          .bind(data.video.url, r2Key, spot.id)
          .run();
      } else if (data.status === 'failed' || data.status === 'nsfw') {
        await env.DB.prepare("UPDATE mkt_spots SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(data.detail ?? `Generation ${data.status}`, spot.id)
          .run();
      }
    } catch (err) {
      console.error(`Spot poll failed for ${spot.id}:`, err);
    }
  }

  // Importing → ready once the media-import cron has landed the file in R2.
  await env.DB.prepare(
    `UPDATE mkt_spots SET status = 'ready', updated_at = datetime('now')
     WHERE status = 'importing'
       AND EXISTS (SELECT 1 FROM media_imports m WHERE m.r2_key = mkt_spots.r2_key AND m.status = 'done')`
  ).run();
  await env.DB.prepare(
    `UPDATE mkt_spots SET status = 'failed', error = 'R2 import failed', updated_at = datetime('now')
     WHERE status = 'importing'
       AND EXISTS (SELECT 1 FROM media_imports m WHERE m.r2_key = mkt_spots.r2_key AND m.status = 'error')`
  ).run();
}

/** Generate voiceover and/or music via ElevenLabs, stored directly in R2. */
export async function generateSpotAudio(
  env: Env,
  spotId: string,
  opts: { voiceoverText?: string; musicPrompt?: string }
): Promise<string | null> {
  if (!elevenlabsConfigured(env)) {
    return 'ElevenLabs is not configured — set the ELEVENLABS_API_KEY secret.';
  }
  const spot = await env.DB.prepare('SELECT id, duration FROM mkt_spots WHERE id = ?').bind(spotId).first<{ id: string; duration: number }>();
  if (!spot) return 'Spot not found';

  if (opts.voiceoverText?.trim()) {
    const res = await fetch(`${EL_BASE}/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID || EL_VOICE_DEFAULT}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: opts.voiceoverText.trim(), model_id: 'eleven_multilingual_v2' }),
    });
    if (!res.ok) return `Voiceover failed (${res.status})`;
    const key = `cdn/spots/${spotId}-vo.mp3`;
    await env.PRODUCT_IMAGES.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: 'audio/mpeg' } });
    await env.DB.prepare("UPDATE mkt_spots SET voiceover_r2_key = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(key, spotId)
      .run();
    await logUsage(env, 'elevenlabs', 'eleven_multilingual_v2', 'spot_voiceover');
  }

  if (opts.musicPrompt?.trim()) {
    const lengthMs = Math.max(10000, Math.min(30000, (spot.duration + 5) * 1000));
    const res = await fetch(`${EL_BASE}/v1/music?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: opts.musicPrompt.trim(), music_length_ms: lengthMs }),
    });
    if (!res.ok) return `Music failed (${res.status})`;
    const key = `cdn/spots/${spotId}-music.mp3`;
    await env.PRODUCT_IMAGES.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: 'audio/mpeg' } });
    await env.DB.prepare("UPDATE mkt_spots SET music_r2_key = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(key, spotId)
      .run();
    await logUsage(env, 'elevenlabs', 'music_v1', 'spot_music');
  }
  return null;
}
