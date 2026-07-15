import { test, expect } from './fixtures';
import { ensureUser } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';

test.describe.serial('Product-event social generator', () => {
  const productName = `E2E Harissa Honey ${Date.now().toString(36)}`;

  test('publishing a product drafts a kit; kits are idempotent per event', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Publish a product through the admin API (fires the product_published event)
    const create = await page.request.post('/api/admin/products', {
      data: {
        name: productName,
        collection: 'seasoning',
        description: 'Sweet heat: harissa chile warmth folded into wildflower honey crystals.',
        price: 1400,
        isActive: true,
      },
    });
    expect(create.status()).toBe(201);

    // Drain events (AI is disabled locally, so the honest template path runs)
    const process1 = await page.request.post('/api/admin/marketing/drafts/process');
    expect(process1.ok()).toBeTruthy();
    const r1 = (await process1.json()) as { drafted: number };
    expect(r1.drafted).toBeGreaterThanOrEqual(1);

    // The draft appears in the studio, grounded in the real product facts
    await page.goto('/admin/marketing');
    const card = page.locator('.rx-card', { hasText: `Launch kit — ${productName}` });
    await expect(card).toBeVisible();
    await expect(card.getByText('NEW', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Review & edit' }).click();
    const tweet = card.locator('textarea').nth(1);
    await expect(tweet).toHaveValue(new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(tweet).toHaveValue(/harissa/i);

    // Idempotence: draining again creates nothing new for this product
    const process2 = await page.request.post('/api/admin/marketing/drafts/process');
    const r2 = (await process2.json()) as { drafted: number };
    const drafts = (await (await page.request.get('/api/admin/marketing/drafts')).json()) as {
      drafts: { title: string }[];
    };
    const mine = drafts.drafts.filter((d) => d.title.includes(productName));
    expect(mine.length).toBe(1);
    expect(r2.drafted + mine.length).toBeLessThanOrEqual(1 + r2.drafted); // no duplicate kit for the product

    // Edit + hand off to the campaign composer
    await tweet.fill(`Edited tweet about ${productName}`);
    await card.getByRole('button', { name: 'Save edits' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
    await card.getByRole('button', { name: 'To composer' }).click();
    await expect(page.getByText(/Loaded into the composer as campaign/)).toBeVisible();

    // The campaign exists with the kit's email content
    const campaigns = (await (await page.request.get('/api/admin/marketing/campaigns')).json()) as {
      campaigns: { name: string }[];
    };
    expect(campaigns.campaigns.some((c) => c.name.includes(productName))).toBeTruthy();
  });
});
