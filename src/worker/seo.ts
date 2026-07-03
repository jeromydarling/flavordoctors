import type { Env, ProductRow } from './types';

/**
 * Edge SEO for the SPA: per-route <title>, meta description, canonical,
 * Open Graph/Twitter tags, and JSON-LD structured data are injected into
 * the static shell with HTMLRewriter, so crawlers and link unfurlers get
 * page-specific metadata without SSR. Plus robots.txt, sitemap.xml, llms.txt.
 */

const BRAND = 'Flavor Doctors';
const DEFAULT_DESCRIPTION =
  'Small-batch doctored mayos, ghee butters, burger sauces, ice cream toppers, and fry seasonings — prescribed for chronic blandness. Free shipping over $45.';

interface PageMeta {
  title: string;
  description: string;
  canonicalPath: string;
  ogType?: string;
  ogImage?: string | null;
  jsonLd?: object[];
}

const STATIC_ROUTES: Record<string, { title: string; description: string }> = {
  '/': {
    title: `${BRAND} — Prescription-Strength Flavor, Small-Batch Sauces & Seasonings`,
    description: DEFAULT_DESCRIPTION,
  },
  '/menu': {
    title: `The Menu — All 34 Treatments | ${BRAND}`,
    description:
      'Browse doctored mayos, shelf-stable ghee butters, burger sauces, dessert toppers, and fry seasonings. Any 3+ items save 15% automatically.',
  },
  '/subscribe': {
    title: `Monthly Rx Box — Choose Your Own Subscription | ${BRAND}`,
    description:
      'The only sauce subscription where you choose every item, across 5 categories. From $39/box with free shipping. Monthly, every-2-months, or annual with 2 months free.',
  },
  '/trials': {
    title: `Clinical Trials — Limited Flavor Drops | ${BRAND}`,
    description:
      'Limited-batch experimental flavors that may never return. Rx Box subscribers get 48-hour early access to every trial.',
  },
  '/intake-exam': {
    title: `The Intake Exam — Get Your Flavor Diagnosis | ${BRAND}`,
    description:
      'Five questions, one diagnosis, a personalized prescription of sauces and seasonings. The 60-second flavor quiz.',
  },
  '/about': {
    title: `Our Story | ${BRAND}`,
    description:
      'Flavor Doctors started with a simple diagnosis: most food is under-treated. Small-batch sauces and seasonings, made with real ingredients.',
  },
  '/faq': {
    title: `FAQ — Patient Information Leaflet | ${BRAND}`,
    description:
      'Dosage, storage, shipping, subscriptions, and known side effects (you will eat this on everything).',
  },
  '/login': {
    title: `Patient Check-In | ${BRAND}`,
    description: 'Sign in or register to manage orders and your Monthly Rx Box.',
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function resolveMeta(pathname: string, origin: string, env: Env): Promise<PageMeta | null> {
  const fallbackImage = null;

  if (STATIC_ROUTES[pathname]) {
    const base: PageMeta = {
      ...STATIC_ROUTES[pathname],
      canonicalPath: pathname,
      ogType: 'website',
      ogImage: fallbackImage,
    };
    if (pathname === '/') {
      base.jsonLd = [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: BRAND,
          url: origin,
          logo: `${origin}/favicon.svg`,
          description: DEFAULT_DESCRIPTION,
          slogan: 'Side effects may include eating this on everything.',
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: BRAND,
          url: origin,
        },
      ];
    }
    return base;
  }

  const productMatch = pathname.match(/^\/product\/([a-z0-9-]+)$/);
  if (productMatch) {
    const product = await env.DB.prepare('SELECT * FROM products WHERE slug = ? AND is_active = 1')
      .bind(productMatch[1])
      .first<ProductRow>();
    if (!product) return null;
    const ratingAgg = await env.DB.prepare(
      'SELECT COUNT(*) AS n, AVG(rating) AS avg FROM product_ratings WHERE product_id = ?'
    )
      .bind(product.id)
      .first<{ n: number; avg: number | null }>();
    const aggregateRating =
      ratingAgg && ratingAgg.n > 0 && ratingAgg.avg
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(ratingAgg.avg.toFixed(1)),
              reviewCount: ratingAgg.n,
            },
          }
        : {};
    const imageUrl = product.image_r2_key ? `${origin}/images/${product.image_r2_key}` : fallbackImage;
    return {
      title: `${product.name} — ${collectionLabel(product.collection)} | ${BRAND}`,
      description: product.description,
      canonicalPath: pathname,
      ogType: 'product',
      ogImage: imageUrl,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          description: product.description,
          ...(imageUrl ? { image: imageUrl } : {}),
          url: `${origin}${pathname}`,
          brand: { '@type': 'Brand', name: BRAND },
          ...aggregateRating,
          offers: {
            '@type': 'Offer',
            price: (product.price / 100).toFixed(2),
            priceCurrency: 'USD',
            availability:
              product.is_drop === 1 && product.drop_stock !== null && product.drop_stock <= 0
                ? 'https://schema.org/SoldOut'
                : 'https://schema.org/InStock',
            url: `${origin}${pathname}`,
          },
        },
      ],
    };
  }

  return null; // account/admin/unknown routes: no injection
}

function collectionLabel(key: string): string {
  const labels: Record<string, string> = {
    mayo: 'Doctored Mayo',
    butter: 'Doctored Ghee Butter',
    'burger-sauce': 'Doctored Burger Sauce',
    toppers: 'Ice Cream Toppers',
    seasoning: 'Fry Seasoning',
  };
  return labels[key] ?? key;
}

function headTags(meta: PageMeta, origin: string): string {
  const url = `${origin}${meta.canonicalPath}`;
  const tags = [
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:type" content="${meta.ogType ?? 'website'}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    ...(meta.ogImage ? [`<meta property="og:image" content="${escapeHtml(meta.ogImage)}">`] : []),
    `<meta name="twitter:card" content="${meta.ogImage ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    ...(meta.jsonLd ?? []).map(
      (schema) => `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`
    ),
  ];
  return tags.join('\n    ');
}

/** Inject per-route metadata (and GA4) into the SPA shell HTML response. */
export async function withPageMeta(req: Request, env: Env, res: Response): Promise<Response> {
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/html')) return res;
  const url = new URL(req.url);
  const meta = await resolveMeta(url.pathname, url.origin, env).catch(() => null);

  const gtag = env.GA4_MEASUREMENT_ID
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${env.GA4_MEASUREMENT_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${env.GA4_MEASUREMENT_ID}');</script>`
    : '';
  if (!meta && !gtag) return res;

  let rewriter = new HTMLRewriter();
  if (meta) {
    rewriter = rewriter.on('title', {
      element(el) {
        el.setInnerContent(meta.title);
      },
    });
  }
  rewriter = rewriter.on('head', {
    element(el) {
      el.append(`${meta ? headTags(meta, url.origin) : ''}${gtag}`, { html: true });
    },
  });
  return rewriter.transform(res);
}

export function robotsTxt(origin: string): Response {
  const body = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /account
Disallow: /checkout/

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' } });
}

export async function sitemapXml(env: Env, origin: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT slug, created_at FROM products WHERE is_active = 1 ORDER BY collection, name'
  ).all<{ slug: string; created_at: string }>();

  const staticUrls = Object.keys(STATIC_ROUTES).filter((p) => p !== '/login');
  const entries = [
    ...staticUrls.map((p) => `  <url><loc>${origin}${p}</loc></url>`),
    ...results.map(
      (r) =>
        `  <url><loc>${origin}/product/${r.slug}</loc><lastmod>${r.created_at.slice(0, 10)}</lastmod></url>`
    ),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
  });
}

/** llms.txt: a linked map of the site for AI assistants and answer engines. */
export async function llmsTxt(env: Env, origin: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT slug, name, collection, description, price FROM products WHERE is_active = 1 AND is_drop = 0 ORDER BY collection, name'
  ).all<{ slug: string; name: string; collection: string; description: string; price: number }>();

  const byCollection = new Map<string, typeof results>();
  for (const p of results) {
    byCollection.set(p.collection, [...(byCollection.get(p.collection) ?? []), p]);
  }

  const productSections = [...byCollection.entries()]
    .map(
      ([key, items]) =>
        `### ${collectionLabel(key)}\n` +
        items
          .map((p) => `- [${p.name}](${origin}/product/${p.slug}): ${p.description} ($${(p.price / 100).toFixed(2)})`)
          .join('\n')
    )
    .join('\n\n');

  const body = `# ${BRAND}

> Small-batch, medically-themed condiment brand: doctored mayos, shelf-stable ghee butters, burger sauces, ice cream toppers, and fry seasonings. Every product is framed as a "prescription." Subscription = the Monthly Rx Box ($39/$54/$69 for 4/6/8 items, customer chooses every item, free shipping, monthly / every-2-months / annual cadences).

## Key pages

- [The Menu — full catalog](${origin}/menu): all products with collection filtering
- [Monthly Rx Box — subscriptions](${origin}/subscribe): tiers, savings, cadence options
- [Clinical Trials — limited drops](${origin}/trials): limited-batch flavors, subscriber early access
- [The Intake Exam — flavor quiz](${origin}/intake-exam): 60-second diagnosis with product recommendations
- [FAQ — Patient Information Leaflet](${origin}/faq): shipping, storage, subscription management
- [About — brand story](${origin}/about)

## Products

${productSections}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
