import type { ProductRow, RequestContext } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { runChat, type ChatMessage } from '../lib/ai';
import { publicProduct } from './products';

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The Pharmacist: AI flavor consult grounded in the live catalog.
 * Describe your symptoms ("dinner is boring") and get a treatment.
 */
export async function pharmacistChat(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<{ messages?: IncomingMessage[] }>(req);
  const incoming = (body?.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  if (incoming.length === 0 || incoming[incoming.length - 1].role !== 'user') {
    return errorResponse('messages must end with a user message');
  }

  const { results: products } = await rc.env.DB.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND is_drop = 0 ORDER BY collection, name'
  ).all<ProductRow>();

  const catalog = products
    .map((p) => `- ${p.name} [${p.collection}] $${(p.price / 100).toFixed(2)}: ${p.description}`)
    .join('\n');

  const system: ChatMessage = {
    role: 'system',
    content: `You are The Pharmacist at Flavor Doctors, a premium small-batch sauce and seasoning brand with a playful medical theme. Patients describe food "symptoms" (boring dinners, dry chicken, sad desserts) and you prescribe products from THIS CATALOG ONLY:

${catalog}

Rules: recommend 1-3 specific products by exact name with a one-line usage "dosage" each. Stay in character (warm, witty, clinical). Keep replies under 120 words. If asked about anything unrelated to food or the catalog, gently steer back to flavor medicine. Never invent products, prices, or medical claims — this is food, not medicine, and say so if anyone seems to take the theme literally.`,
  };

  let reply: string;
  try {
    reply = await runChat(rc.env, [system, ...incoming], 400);
  } catch (err) {
    console.error('Pharmacist AI failed:', err);
    return errorResponse('The Pharmacist is with another patient — try again shortly', 503);
  }

  // Attach any catalog products mentioned by name so the UI can link them.
  const lower = reply.toLowerCase();
  const suggested = products.filter((p) => lower.includes(p.name.toLowerCase())).slice(0, 3).map(publicProduct);

  return json({ reply, suggested });
}
