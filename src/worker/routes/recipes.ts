import type { ProductRow, RequestContext } from '../types';
import { json, errorResponse, readJson, newId, slugify } from '../lib/util';
import { requireAdmin } from '../lib/auth';
import { audit } from '../lib/audit';
import { runChat } from '../lib/ai';

interface RecipeRow {
  id: string;
  slug: string;
  title: string;
  product_id: string;
  intro: string;
  body_html: string;
  is_published: number;
  created_at: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Strip everything but a small whitelist of formatting tags from AI/admin HTML. */
function sanitizeBody(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<(?!\/?(h2|h3|p|ul|ol|li|strong|em|br)\b)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function pageShell(title: string, description: string, canonical: string, inner: string, jsonLd?: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} — Flavor Doctors Treatment Plans</title>
<meta name="description" content="${esc(description)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article"><meta property="og:url" content="${canonical}">
${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}
<style>
body{font-family:Georgia,serif;background:#0D1B2A;color:#F5F5F5;margin:0;line-height:1.7}
.wrap{max-width:720px;margin:0 auto;padding:48px 20px}
a{color:#2ECC71}
h1{font-size:40px;line-height:1.15;margin:8px 0 4px}
h2{color:#F5A623;margin-top:36px}
h3{color:#2ECC71}
.kicker{color:#F5A623;text-transform:uppercase;letter-spacing:3px;font-size:13px;font-weight:bold}
.intro{font-size:19px;color:#c9d2dc}
.cta{display:inline-block;background:#2ECC71;color:#0D1B2A;font-weight:800;padding:14px 24px;border-radius:10px;text-decoration:none;margin-top:20px}
.card{background:#16293F;border:2px solid #1F3A57;border-radius:14px;padding:20px 24px;margin:28px 0}
ul,ol{padding-left:24px}
li{margin:6px 0}
footer{margin-top:48px;color:#7d8b9a;font-size:14px}
.plan{display:block;background:#16293F;border:2px solid #1F3A57;border-radius:14px;padding:18px 22px;margin:14px 0;text-decoration:none}
.plan strong{color:#F5F5F5;font-size:19px}
.plan span{color:#c9d2dc;display:block;margin-top:4px}
</style></head><body><div class="wrap">
<a href="/" style="text-decoration:none">🩺 <strong style="color:#F5F5F5">Flavor Doctors</strong></a>
${inner}
<footer>Flavor Doctors — premium small-batch sauces & seasonings. <a href="/menu">Browse the menu</a> · <a href="/treatment-plans">All treatment plans</a></footer>
</div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

/** Public index: /treatment-plans */
export async function treatmentPlansIndex(req: Request, rc: RequestContext): Promise<Response> {
  const { results } = await rc.env.DB.prepare(
    `SELECT r.slug, r.title, r.intro, p.name AS product_name FROM recipes r
     JOIN products p ON p.id = r.product_id
     WHERE r.is_published = 1 ORDER BY r.created_at DESC LIMIT 100`
  ).all<{ slug: string; title: string; intro: string; product_name: string }>();
  const origin = rc.env.CANONICAL_HOST ? `https://${rc.env.CANONICAL_HOST}` : new URL(req.url).origin;
  const inner = `
<p class="kicker">Treatment Plans</p>
<h1>Prescribed recipes for chronic blandness</h1>
<p class="intro">Every plan pairs a Flavor Doctors treatment with a dinner it cures. Written by the clinic, tested on real patients.</p>
${
  results.length === 0
    ? '<p class="intro">The clinic is writing its first treatment plans — check back soon.</p>'
    : results
        .map(
          (r) =>
            `<a class="plan" href="/treatment-plans/${r.slug}"><strong>${esc(r.title)}</strong><span>${esc(r.intro.slice(0, 140))}${r.intro.length > 140 ? '…' : ''}</span><span style="color:#F5A623">Rx: ${esc(r.product_name)}</span></a>`
        )
        .join('\n')
}`;
  return pageShell(
    'Treatment Plans (Recipes)',
    'Doctor-prescribed recipes pairing Flavor Doctors sauces and seasonings with the dinners they cure.',
    `${origin}/treatment-plans`,
    inner
  );
}

/** Public article: /treatment-plans/:slug — server-rendered with Recipe JSON-LD. */
export async function treatmentPlanPage(req: Request, rc: RequestContext): Promise<Response> {
  const recipe = await rc.env.DB.prepare(
    `SELECT r.*, p.name AS product_name, p.slug AS product_slug, p.price, p.image_r2_key FROM recipes r
     JOIN products p ON p.id = r.product_id WHERE r.slug = ? AND r.is_published = 1`
  )
    .bind(rc.params.slug)
    .first<RecipeRow & { product_name: string; product_slug: string; price: number; image_r2_key: string | null }>();
  if (!recipe) return errorResponse('Not found', 404);

  const origin = rc.env.CANONICAL_HOST ? `https://${rc.env.CANONICAL_HOST}` : new URL(req.url).origin;
  const canonical = `${origin}/treatment-plans/${recipe.slug}`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
    description: recipe.intro,
    ...(recipe.image_r2_key ? { image: `${origin}/images/${recipe.image_r2_key}` } : {}),
    author: { '@type': 'Organization', name: 'Flavor Doctors' },
    datePublished: recipe.created_at.slice(0, 10),
  });
  const inner = `
<p class="kicker">Treatment Plan</p>
<h1>${esc(recipe.title)}</h1>
<p class="intro">${esc(recipe.intro)}</p>
${sanitizeBody(recipe.body_html)}
<div class="card">
<p class="kicker">The prescription</p>
<p><strong>${esc(recipe.product_name)}</strong> — $${(recipe.price / 100).toFixed(2)}. Small-batch, doctor-approved, no refill limits.</p>
<a class="cta" href="/product/${recipe.product_slug}">Fill this prescription →</a>
</div>`;
  return pageShell(recipe.title, recipe.intro, canonical, inner, jsonLd);
}

// ---------- Admin ----------

/** AI-draft a treatment plan for a product (falls back to a template offline). */
export const generateRecipe = requireAdmin(async (req, rc) => {
  const b = await readJson<{ productId?: string; dish?: string }>(req);
  if (!b?.productId) return errorResponse('productId required');
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(b.productId).first<ProductRow>();
  if (!product) return errorResponse('Product not found', 404);
  const dish = b.dish?.trim().slice(0, 80) || 'a weeknight dinner';

  let title = `${product.name} ${dish.charAt(0).toUpperCase() + dish.slice(1)}`;
  let intro = `A doctor-prescribed cure for boring ${dish}: ${product.name} does the heavy lifting while you take the credit.`;
  let bodyHtml = `<h2>Symptoms</h2><p>Chronic blandness presenting at the dinner table, especially around ${esc(dish)}.</p>
<h2>Ingredients</h2><ul><li>1 jar/bottle of ${esc(product.name)}</li><li>Your usual ${esc(dish)} base</li><li>Salt, pepper, and 20 minutes</li></ul>
<h2>Treatment protocol</h2><ol><li>Prep your ${esc(dish)} as usual.</li><li>Apply ${esc(product.name)} generously — clinical dosage is "more than you think".</li><li>Finish, taste, adjust. Repeat weekly until symptoms resolve.</li></ol>
<h2>Doctor's notes</h2><p>${esc(product.description)}</p>`;

  try {
    const raw = await runChat(
      rc.env,
      [
        {
          role: 'system',
          content:
            'You write recipes for "Flavor Doctors", a premium sauce & seasoning brand with a playful medical/prescription theme. Respond ONLY with JSON: {"title": string (max 70 chars, no quotes), "intro": string (1-2 sentence hook, max 200 chars), "bodyHtml": string (HTML with <h2> sections: Symptoms, Ingredients (as <ul>), Treatment protocol (as <ol> with 4-6 numbered steps), Doctor\'s notes; no scripts or links)}. Keep it practical and genuinely cookable, with the medical humor as seasoning, not the main course.',
        },
        {
          role: 'user',
          content: `Product: ${product.name} — ${product.description}. Write a treatment plan (recipe) using it for: ${dish}.`,
        },
      ],
      1200
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
      title?: string;
      intro?: string;
      bodyHtml?: string;
    };
    if (parsed.title?.trim()) title = parsed.title.trim().slice(0, 90);
    if (parsed.intro?.trim()) intro = parsed.intro.trim().slice(0, 300);
    if (parsed.bodyHtml?.trim()) bodyHtml = sanitizeBody(parsed.bodyHtml);
  } catch (err) {
    console.error('Recipe AI generation failed, using template:', err);
  }

  return json({ draft: { title, intro, bodyHtml, productId: product.id } });
});

export const listRecipes = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    `SELECT r.id, r.slug, r.title, r.is_published, r.created_at, p.name AS product_name
     FROM recipes r JOIN products p ON p.id = r.product_id ORDER BY r.created_at DESC LIMIT 200`
  ).all();
  return json({ recipes: results });
});

export const saveRecipe = requireAdmin(async (req, rc) => {
  const b = await readJson<{ productId?: string; title?: string; intro?: string; bodyHtml?: string; publish?: boolean }>(req);
  if (!b?.productId || !b.title?.trim() || !b.intro?.trim() || !b.bodyHtml?.trim()) {
    return errorResponse('productId, title, intro, bodyHtml required');
  }
  const product = await rc.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(b.productId).first();
  if (!product) return errorResponse('Product not found', 404);

  const id = newId('rcp');
  const base = slugify(b.title.trim());
  // Slugs are unique; suffix with the id tail on collision.
  const dup = await rc.env.DB.prepare('SELECT 1 FROM recipes WHERE slug = ?').bind(base).first();
  const slug = dup ? `${base}-${id.slice(-4)}` : base;
  await rc.env.DB.prepare(
    'INSERT INTO recipes (id, slug, title, product_id, intro, body_html, is_published) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, slug, b.title.trim().slice(0, 90), b.productId, b.intro.trim().slice(0, 300), sanitizeBody(b.bodyHtml), b.publish ? 1 : 0)
    .run();
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'recipe_create', id, `${b.title.trim()}${b.publish ? ' (published)' : ''}`));
  return json({ id, slug }, 201);
});

/** Full recipe for the admin editor (list omits the body). */
export const getRecipeAdmin = requireAdmin(async (_req, rc) => {
  const recipe = await rc.env.DB.prepare('SELECT * FROM recipes WHERE id = ?').bind(rc.params.id).first<RecipeRow>();
  if (!recipe) return errorResponse('Recipe not found', 404);
  return json({
    recipe: {
      id: recipe.id,
      slug: recipe.slug,
      title: recipe.title,
      intro: recipe.intro,
      bodyHtml: recipe.body_html,
      productId: recipe.product_id,
      isPublished: recipe.is_published === 1,
    },
  });
});

/** Edit a recipe's text. The slug never changes, so published URLs stay stable. */
export const updateRecipe = requireAdmin(async (req, rc) => {
  const b = await readJson<{ title?: string; intro?: string; bodyHtml?: string }>(req);
  if (!b?.title?.trim() || !b.intro?.trim() || !b.bodyHtml?.trim()) {
    return errorResponse('title, intro, bodyHtml required');
  }
  const result = await rc.env.DB.prepare('UPDATE recipes SET title = ?, intro = ?, body_html = ? WHERE id = ?')
    .bind(b.title.trim().slice(0, 90), b.intro.trim().slice(0, 300), sanitizeBody(b.bodyHtml), rc.params.id)
    .run();
  if (result.meta.changes === 0) return errorResponse('Recipe not found', 404);
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'recipe_update', rc.params.id, b.title.trim()));
  return json({ ok: true });
});

export const setRecipePublished = requireAdmin(async (req, rc) => {
  const b = await readJson<{ publish?: boolean }>(req);
  const result = await rc.env.DB.prepare('UPDATE recipes SET is_published = ? WHERE id = ?')
    .bind(b?.publish ? 1 : 0, rc.params.id)
    .run();
  if (result.meta.changes === 0) return errorResponse('Recipe not found', 404);
  return json({ ok: true });
});

export const deleteRecipe = requireAdmin(async (_req, rc) => {
  const result = await rc.env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(rc.params.id).run();
  if (result.meta.changes === 0) return errorResponse('Recipe not found', 404);
  return json({ ok: true });
});
