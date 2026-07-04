import { test, expect } from './fixtures';
import { uniqueEmail, ensureUser, loginViaUi, registerViaUi, sendWebhook, orderPaidEvent, currentUserId, npsSig } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';
const RUN = Date.now().toString(36);

/**
 * Retention wave: back-in-stock alerts driven by the inventory ledger,
 * the Treatment Plans SEO hub, and the one-click NPS pulse loop.
 */
test.describe.serial('Restock alerts, Treatment Plans & NPS', () => {
  const SKU_NAME = `Restock Tonic ${RUN}`;
  let productId: string;
  let productSlug: string;

  test('a tracked SKU that sells out flips the product page to notify-me', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await page.request.post('/api/admin/products', {
      data: { name: SKU_NAME, collection: 'toppers', description: 'E2E restock test SKU', price: 899 },
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { product: { id: string; slug: string } };
    productId = body.product.id;
    productSlug = body.product.slug;
    expect(
      (await page.request.post('/api/admin/inventory/receive', { data: { productId, lotCode: 'RSTK-1', quantity: 2 } })).status()
    ).toBe(201);

    // In stock → normal buy button
    await page.goto(`/product/${productSlug}`);
    await expect(page.getByRole('button', { name: '+ Add to Cart' })).toBeVisible();

    // Sell both units → out of stock
    expect(await sendWebhook(page.request, orderPaidEvent(null, uniqueEmail('oos'), [{ p: productId, q: 2 }], 1798))).toBe(200);

    // Anonymous visitor sees the notify-me form and signs up
    await page.request.post('/api/auth/logout');
    await page.goto(`/product/${productSlug}`);
    await expect(page.getByText('Temporarily out of stock')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add to Cart' })).not.toBeVisible();
    await page.getByLabel('Email for restock alert').fill(uniqueEmail('notifyme'));
    await page.getByRole('button', { name: /Notify me when it's back/ }).click();
    await expect(page.getByText("We'll email you the moment it's back.")).toBeVisible();

    // Restock → buy button returns
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(
      (await page.request.post('/api/admin/inventory/receive', { data: { productId, lotCode: 'RSTK-2', quantity: 24 } })).status()
    ).toBe(201);
    await page.goto(`/product/${productSlug}`);
    await expect(page.getByRole('button', { name: '+ Add to Cart' })).toBeVisible();
  });

  test('treatment plan: AI draft → publish → SSR page, product links, sitemap', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // AI is offline locally → the endpoint must fall back to a usable template
    const gen = await page.request.post('/api/admin/recipes/generate', {
      data: { productId: 'p001', dish: 'grilled chicken' },
    });
    expect(gen.status()).toBe(200);
    const { draft } = (await gen.json()) as { draft: { title: string; intro: string; bodyHtml: string; productId: string } };
    expect(draft.bodyHtml).toContain('Treatment protocol');

    const title = `Ranch Rx Grilled Chicken ${RUN}`;
    const saved = await page.request.post('/api/admin/recipes', { data: { ...draft, title, publish: true } });
    expect(saved.status()).toBe(201);
    const { slug } = (await saved.json()) as { slug: string };

    // Content Studio lists it as live
    await page.goto('/admin/content');
    await expect(page.getByText(title)).toBeVisible();

    // SSR index + article render with the product CTA
    await page.goto('/treatment-plans');
    await expect(page.getByRole('heading', { name: 'Prescribed recipes for chronic blandness' })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    await page.goto(`/treatment-plans/${slug}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('link', { name: /Fill this prescription/ })).toBeVisible();

    // Product page cross-links back
    await page.goto('/product/ranch-rx');
    await expect(page.getByText('Treatment plans featuring this')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();

    // And the sitemap picks it up
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    expect(sitemap).toContain(`/treatment-plans/${slug}`);

    // Editing: tweak the intro in the Content Studio; the live page updates
    // at the SAME url (slug is SEO-stable)
    const newIntro = `Edited intro for run ${RUN} — now with 30% more bedside manner.`;
    const bonusLine = `Bonus tip for run ${RUN}: apply twice daily.`;
    await page.goto('/admin/content');
    const row = page.locator('li', { hasText: title });
    await row.getByRole('button', { name: /Edit/ }).click();
    await expect(page.getByText('Editing — the page URL stays the same')).toBeVisible();
    await page.getByLabel('Recipe intro').fill(newIntro);

    // The body opens in the rich editor with formatted headings, not raw HTML
    const editor = page.getByRole('textbox', { name: 'Recipe body' });
    await expect(editor.locator('h2', { hasText: 'Treatment protocol' })).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(` ${bonusLine}`);

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved', { exact: false })).toBeVisible();

    await page.goto(`/treatment-plans/${slug}`);
    await expect(page.getByText(newIntro)).toBeVisible();
    await expect(page.getByText(bonusLine)).toBeVisible();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });

  test('NPS pulse: signed links record scores; detractors open a ticket', async ({ page }) => {
    const buyer = uniqueEmail('nps');
    await registerViaUi(page, buyer);
    const uid = await currentUserId(page);
    expect(await sendWebhook(page.request, orderPaidEvent(uid, buyer, [{ p: 'p001', q: 1 }], 999))).toBe(200);
    const orders = (await (await page.request.get('/api/account/orders')).json()) as { orders: { id: string }[] };
    const orderId = orders.orders[0].id;

    // Forged links bounce
    const forged = await page.request.get(`/nps?o=${orderId}&e=${encodeURIComponent(buyer)}&s=2&sig=deadbeefdeadbeef`);
    expect(forged.status()).toBe(400);

    // Detractor → themed response + auto-ticket in the inbox
    await page.goto(`/nps?o=${orderId}&e=${encodeURIComponent(buyer)}&s=2&sig=${npsSig(orderId, buyer)}`);
    await expect(page.getByText('We hear you', { exact: false })).toBeVisible();

    // Promoter follow-up overwrites the score and nudges review + referral
    await page.goto(`/nps?o=${orderId}&e=${encodeURIComponent(buyer)}&s=10&sig=${npsSig(orderId, buyer)}`);
    await expect(page.getByText('Music to our stethoscopes', { exact: false })).toBeVisible();

    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/inbox');
    await expect(page.getByText(`NPS follow-up · order ${orderId}`, { exact: false })).toBeVisible();

    const analytics = (await (await page.request.get('/api/admin/analytics')).json()) as {
      nps: { responses: number; score: number | null };
    };
    expect(analytics.nps.responses).toBeGreaterThanOrEqual(1);
  });

  test('cleanup: deactivate the restock test SKU', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect((await page.request.delete(`/api/admin/products/${productId}`)).status()).toBe(200);
  });
});
