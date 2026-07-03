import { test, expect } from './fixtures';
import {
  uniqueEmail,
  ensureUser,
  loginViaUi,
  registerViaUi,
  sendWebhook,
  orderPaidEvent,
  subscriptionCreatedEvent,
  currentUserId,
} from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';
const SKU_NAME = `Stockcheck Serum ${Date.now().toString(36)}`;
let productId: string;

/**
 * Inventory lifecycle: receive co-packer lots → orders ship FEFO (earliest
 * best-by first) → subscription boxes commit stock ahead of billing →
 * adjustments and receipts land in the audit trail → support can view but
 * not mutate. Uses a throwaway SKU so reruns never collide.
 */
test.describe.serial('Inventory: lots, FEFO & committed stock', () => {
  test('admin creates a test SKU and receives two lots', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await page.request.post('/api/admin/products', {
      data: { name: SKU_NAME, collection: 'seasoning', description: 'E2E inventory test SKU', price: 999 },
    });
    expect(created.status()).toBe(201);
    productId = ((await created.json()) as { product: { id: string } }).product.id;

    // The LATER-expiring lot arrives first, so correct picking must be FEFO, not FIFO.
    const late = await page.request.post('/api/admin/inventory/receive', {
      data: { productId, lotCode: 'LOT-LATE', quantity: 40, bestBy: '2028-06-01' },
    });
    expect(late.status()).toBe(201);
    const early = await page.request.post('/api/admin/inventory/receive', {
      data: { productId, lotCode: 'LOT-EARLY', quantity: 10, bestBy: '2027-01-01', poRef: 'PO-77' },
    });
    expect(early.status()).toBe(201);

    await page.goto('/admin/inventory');
    const row = page.locator('table').first().getByRole('row', { name: new RegExp(SKU_NAME) });
    await expect(row.getByRole('cell').nth(1)).toHaveText('50'); // on hand
    await expect(row.getByRole('cell').nth(3)).toHaveText('50'); // available
    await expect(row.getByText('ok')).toBeVisible();
  });

  test('a paid order consumes the earliest-expiring lot first', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const status = await sendWebhook(
      page.request,
      orderPaidEvent(null, uniqueEmail('invbuyer'), [{ p: productId, q: 3 }], 2997)
    );
    expect(status).toBe(200);

    await page.goto('/admin/inventory');
    const row = page.locator('table').first().getByRole('row', { name: new RegExp(SKU_NAME) });
    await expect(row.getByRole('cell').nth(1)).toHaveText('47');
    await row.click(); // expand lots
    await expect(page.locator('li', { hasText: 'LOT-EARLY' })).toContainText('7/10 left');
    await expect(page.locator('li', { hasText: 'LOT-LATE' })).toContainText('40/40 left');
  });

  test('a live subscription box commits stock before it bills', async ({ page }) => {
    const email = uniqueEmail('invsub');
    await registerViaUi(page, email);
    const uid = await currentUserId(page);
    expect(await sendWebhook(page.request, subscriptionCreatedEvent(uid, email, 'starter'))).toBe(200);

    // Put the test SKU in the box (starter holds exactly 4 unique items).
    const products = (await (await page.request.get('/api/products')).json()) as { products: { id: string }[] };
    const others = products.products.map((p) => p.id).filter((id) => id !== productId).slice(0, 3);
    const updated = await page.request.put('/api/account/subscription/items', {
      data: { items: [productId, ...others] },
    });
    expect(updated.status()).toBe(200);

    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/inventory');
    const row = page.locator('table').first().getByRole('row', { name: new RegExp(SKU_NAME) });
    await expect(row.getByRole('cell').nth(2)).toHaveText('1'); // committed
    await expect(row.getByRole('cell').nth(3)).toHaveText('46'); // 47 on hand - 1 committed
  });

  test('negative adjustment pulls FEFO and lands in the audit trail', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await page.request.post('/api/admin/inventory/adjust', {
      data: { productId, delta: -2, reason: 'damaged in transit' },
    });
    expect(res.status()).toBe(200);

    await page.goto('/admin/inventory');
    const row = page.locator('table').first().getByRole('row', { name: new RegExp(SKU_NAME) });
    await expect(row.getByRole('cell').nth(1)).toHaveText('45');
    await row.click();
    await expect(page.locator('li', { hasText: 'LOT-EARLY' })).toContainText('5/10 left');

    // Receipts and adjustments are audited with who/what/why
    await page.goto('/admin/staff');
    await expect(page.getByRole('cell', { name: 'stock_adjust' }).first()).toBeVisible();
    await expect(page.getByText('damaged in transit').first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'stock_receive' }).first()).toBeVisible();
  });

  test('support reps can view the board but not receive or adjust', async ({ page }) => {
    const repEmail = uniqueEmail('invrep');
    await registerViaUi(page, repEmail);
    await page.request.post('/api/auth/logout');
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(
      (await page.request.post('/api/admin/staff/role', { data: { email: repEmail, role: 'support' } })).status()
    ).toBe(200);

    await loginViaUi(page, repEmail);
    await page.goto('/admin/inventory');
    await expect(page.locator('table').first().getByRole('row', { name: new RegExp(SKU_NAME) })).toBeVisible();
    await expect(page.getByText('Receive a delivery')).not.toBeVisible(); // admin-only forms hidden
    expect(
      (await page.request.post('/api/admin/inventory/receive', { data: { productId, lotCode: 'X', quantity: 1 } })).status()
    ).toBe(403);
    expect(
      (await page.request.post('/api/admin/inventory/adjust', { data: { productId, delta: -1, reason: 'nope' } })).status()
    ).toBe(403);
  });

  test('cleanup: deactivate the test SKU', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect((await page.request.delete(`/api/admin/products/${productId}`)).status()).toBe(200);
  });
});
