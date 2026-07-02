import type { Env, ProductRow } from '../types';
import { base64ToBytes } from './util';

const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

const CONTAINER_BY_COLLECTION: Record<string, string> = {
  mayo: 'glass jar (8 oz)',
  'burger-sauce': 'glass jar (8 oz)',
  toppers: 'glass jar (8 oz)',
  butter: 'parchment-wrapped butter roll (4 oz)',
  seasoning: 'amber glass shaker jar (4 oz)',
};

export function containerFor(collection: string): string {
  return CONTAINER_BY_COLLECTION[collection] ?? 'glass jar';
}

/** Generate a prescription-style product description with Workers AI. */
export async function generateDescription(env: Env, product: ProductRow): Promise<string> {
  const prompt = `You are the copywriter for "Flavor Doctors", a premium small-batch sauce and seasoning brand with a playful medical/prescription theme.

Write a short product description for this product, formatted EXACTLY as a prescription with these labeled lines:

Prescribed for: <one witty sentence about what cravings/foods this treats>
Active ingredients: <flavor notes, evocative but grounded in the real flavors>
Dosage: <playful serving suggestion>
Side effects: <one funny line, e.g. "You'll eat this on everything">
Refills: <short punchy line encouraging the Monthly Rx Box subscription>

Product: ${product.name}
Category: ${product.collection}
What it is: ${product.description}

Keep it under 120 words total. No preamble, no markdown, output only the five labeled lines.`;

  const result = (await env.AI.run(TEXT_MODEL as Parameters<Ai['run']>[0], {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 512,
  })) as { response?: string };

  const text = result.response?.trim();
  if (!text) throw new Error('AI returned an empty description');
  return text;
}

/**
 * Generate consistent product photography with Flux (flux-1-schnell)
 * and store it in R2 at products/{slug}/hero.png. Returns the R2 key.
 */
export async function generateProductImage(env: Env, product: ProductRow): Promise<string> {
  const prompt = `Professional product photography of a ${containerFor(product.collection)} labeled '${product.name}' from a brand called Flavor Doctors. Medical prescription aesthetic, clean white background, soft studio lighting, label design features navy blue and gold colors with a stethoscope-spoon logo. Premium artisan small-batch food photography style. Photorealistic.`;

  const result = (await env.AI.run(IMAGE_MODEL as Parameters<Ai['run']>[0], {
    prompt,
    steps: 8,
  })) as { image?: string };

  if (!result.image) throw new Error('Flux returned no image');
  const bytes = base64ToBytes(result.image);
  // flux-1-schnell returns JPEG or PNG bytes; detect via magic numbers so the
  // served Content-Type is always correct regardless of the .png key name.
  const isPng = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50;
  const key = `products/${product.slug}/hero.png`;
  await env.PRODUCT_IMAGES.put(key, bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType: isPng ? 'image/png' : 'image/jpeg' },
  });
  return key;
}
