/**
 * Generate Flux product photography for every SKU from CI (or any machine
 * with a CLOUDFLARE_API_TOKEN) — no admin UI clicking required.
 *
 * For each product missing an image (or all, with REGENERATE_ALL=true):
 *   1. Run @cf/black-forest-labs/flux-1-schnell via the Workers AI REST API
 *   2. Upload the image to R2 at products/{slug}/hero.png (replacing any prior version)
 *   3. Update products.image_r2_key in D1
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN   required — needs Workers AI (Read), Workers R2 Storage (Edit), D1 (Edit)
 *   CLOUDFLARE_ACCOUNT_ID  optional — auto-detected from the token when omitted
 *   REGENERATE_ALL         optional — "true" regenerates every SKU, not just missing ones
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';
const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const DB_NAME = 'flavordoctors-db';
const BUCKET = 'flavordoctors-product-images';

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error('CLOUDFLARE_API_TOKEN is not set');
  process.exit(1);
}
const regenerateAll = process.env.REGENERATE_ALL === 'true';

const CONTAINER_BY_COLLECTION = {
  mayo: 'glass jar (8 oz)',
  'burger-sauce': 'glass jar (8 oz)',
  toppers: 'glass jar (8 oz)',
  butter: 'small amber glass jar of golden spiced ghee butter (4 oz)',
  seasoning: 'amber glass shaker jar (4 oz)',
};

function wrangler(...args) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });
}

async function cfFetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(`${path} failed (${res.status}): ${JSON.stringify(data.errors ?? data).slice(0, 300)}`);
  }
  return data;
}

async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const data = await cfFetch('/accounts');
  const id = data.result?.[0]?.id;
  if (!id) throw new Error('Could not auto-detect account id — set CLOUDFLARE_ACCOUNT_ID');
  console.log(`Auto-detected account: ${data.result[0].name} (${id})`);
  return id;
}

function loadProducts() {
  const where = regenerateAll ? 'is_active = 1' : "is_active = 1 AND (image_r2_key IS NULL OR image_r2_key = '')";
  const out = wrangler(
    'd1', 'execute', DB_NAME, '--remote', '--json',
    '--command', `SELECT id, slug, name, collection FROM products WHERE ${where} ORDER BY id`
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

async function main() {
  const account = await accountId();
  const products = loadProducts();
  console.log(`${products.length} product(s) to generate (regenerateAll=${regenerateAll})`);
  if (products.length === 0) return;

  const dir = mkdtempSync(join(tmpdir(), 'flux-'));
  const generated = [];
  let consecutiveFailures = 0;

  for (const [i, p] of products.entries()) {
    const container = CONTAINER_BY_COLLECTION[p.collection] ?? 'glass jar';
    const prompt = `Professional product photography of a ${container} labeled '${p.name}' from a brand called Flavor Doctors. Medical prescription aesthetic, clean white background, soft studio lighting, label design features navy blue and gold colors with a stethoscope-spoon logo. Premium artisan small-batch food photography style. Photorealistic.`;
    try {
      const data = await cfFetch(`/accounts/${account}/ai/run/${MODEL}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, steps: 8 }),
      });
      const b64 = data.result?.image;
      if (!b64) throw new Error('no image in response');
      const bytes = Buffer.from(b64, 'base64');
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const file = join(dir, `${p.slug}.img`);
      writeFileSync(file, bytes);
      wrangler(
        'r2', 'object', 'put', `${BUCKET}/products/${p.slug}/hero.png`,
        '--file', file, '--content-type', isPng ? 'image/png' : 'image/jpeg', '--remote'
      );
      generated.push(p.slug);
      consecutiveFailures = 0;
      console.log(`[${i + 1}/${products.length}] ✓ ${p.slug} (${Math.round(bytes.length / 1024)} KB ${isPng ? 'png' : 'jpeg'})`);
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`[${i + 1}/${products.length}] ✗ ${p.slug}: ${err.message}`);
      if (consecutiveFailures >= 3) {
        console.error('Three consecutive failures — aborting (likely token permissions or rate limit).');
        break;
      }
    }
  }

  if (generated.length > 0) {
    const list = generated.map((s) => `'${s}'`).join(',');
    wrangler(
      'd1', 'execute', DB_NAME, '--remote',
      '--command', `UPDATE products SET image_r2_key = 'products/' || slug || '/hero.png' WHERE slug IN (${list})`
    );
  }
  console.log(`Done: ${generated.length}/${products.length} images generated and published.`);
  if (generated.length < products.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
