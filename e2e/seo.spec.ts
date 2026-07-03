import { test, expect } from './fixtures';

/** Edge SEO surfaces: robots, sitemap, llms.txt, per-route meta injection, structured data. */
test.describe('SEO surfaces', () => {
  test('robots.txt allows crawling, blocks private areas, links the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /admin/');
    expect(body).toContain('Sitemap:');
    expect(body).toContain('/sitemap.xml');
  });

  test('sitemap.xml lists static routes and all product pages', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');
    const body = await res.text();
    expect(body).toContain('<loc>');
    expect(body).toContain('/menu</loc>');
    expect(body).toContain('/subscribe</loc>');
    expect(body).toContain('/product/ranch-rx</loc>');
    // All 34 products present
    expect(body.match(/\/product\//g)?.length).toBeGreaterThanOrEqual(34);
  });

  test('llms.txt provides a linked site map for AI assistants', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('# Flavor Doctors');
    expect(body).toContain('](');
    expect(body).toContain('/product/ranch-rx');
    expect(body).toContain('/subscribe');
  });

  test('homepage HTML carries brand title, description, canonical, and Organization schema', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    expect(html).toContain('<title>Flavor Doctors — Prescription-Strength Flavor');
    expect(html).toContain('name="description"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('property="og:title"');
  });

  test('product page HTML gets page-specific title, OG tags, and Product schema', async ({ request }) => {
    const res = await request.get('/product/truffle-treatment');
    const html = await res.text();
    expect(html).toContain('<title>Truffle Treatment —');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"price":"14.99"');
    expect(html).toContain('schema.org/InStock');
    // Canonical and og:url point at the product page, not the homepage
    expect(html).toMatch(/rel="canonical" href="[^"]*\/product\/truffle-treatment"/);
    expect(html).toMatch(/property="og:url" content="[^"]*\/product\/truffle-treatment"/);
  });

  test('routes have distinct titles (no shared scaffold title)', async ({ request }) => {
    const titles = new Set<string>();
    for (const path of ['/', '/menu', '/subscribe', '/faq']) {
      const html = await (await request.get(path)).text();
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
      titles.add(title);
    }
    expect(titles.size).toBe(4);
  });

  test('client-side navigation updates document.title', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'FAQ' }).click();
    await expect(page).toHaveTitle(/FAQ — Patient Information Leaflet/);
  });
});
