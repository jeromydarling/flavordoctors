import { test, expect } from './fixtures';
import { uniqueEmail, registerViaUi, ensureUser, loginViaUi, sendWebhook, orderPaidEvent } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com'; // on the ADMIN_EMAILS allowlist
const ADMIN_PASSWORD = 'password-e2e-1';

/**
 * Admin + Clinical Trials lifecycle. Registers the allowlisted admin email
 * (fresh local DB per audit run) and a regular patient to verify access control.
 */
test.describe.serial('Admin & Clinical Trials', () => {
  test('non-admin user is blocked from the admin wing', async ({ page }) => {
    await registerViaUi(page, uniqueEmail('civilian'));
    await page.goto('/admin/products');
    await expect(page.getByText('Restricted Area', { exact: false })).toBeVisible();
  });

  test('allowlisted email gets admin and sees the product catalog', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
    await page.goto('/admin/products');
    await expect(page.getByText(/Product Catalog \(\d+\)/)).toBeVisible();
    await expect(page.getByRole('cell', { name: /Ranch Rx/ })).toBeVisible();
  });

  test('admin can edit a product price and revert it', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/products');
    const row = page.getByRole('row', { name: /Ranch Rx/ });
    await row.getByRole('button', { name: 'Edit' }).click();
    const priceInput = page.getByLabel('Price (USD)');
    await priceInput.fill('10.49');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('row', { name: /Ranch Rx/ }).getByText('$10.49')).toBeVisible();
    // Revert
    await page.getByRole('row', { name: /Ranch Rx/ }).getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Price (USD)').fill('9.99');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('row', { name: /Ranch Rx/ }).getByText('$9.99')).toBeVisible();
  });

  test('admin creates a Clinical Trial drop; it appears on /trials with waitlist', async ({ page }) => {
    // Unique per run — the slug persists in the DB after deactivation.
    const dropName = `E2E Elixir ${Date.now().toString(36)}`;
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/products');
    await page.getByRole('button', { name: '+ New Product' }).click();
    await page.getByLabel('Name').fill(dropName);
    await page.getByLabel('Description').fill('Audit-run limited batch.');
    await page.getByLabel('Price (USD)').fill('19.99');
    await page.getByRole('checkbox', { name: /Clinical Trial/ }).check();
    // Opens in 3 days → upcoming state
    const future = new Date(Date.now() + 3 * 86400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T12:00`;
    await page.getByLabel(/Public enrollment opens/).fill(local);
    await page.getByLabel(/Stock/).fill('25');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('cell', { name: new RegExp(dropName) })).toBeVisible();

    // Drop is on /trials, not on /menu
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: dropName })).not.toBeVisible();
    await page.goto('/trials');
    await expect(page.getByRole('heading', { name: dropName })).toBeVisible();
    await expect(page.getByText('Enrolling soon')).toBeVisible();
    await expect(page.getByText('25 doses left')).toBeVisible();

    // Waitlist signup works
    await page.getByPlaceholder('you@example.com').fill(uniqueEmail('waitlist'));
    await page.getByRole('button', { name: 'Join Waitlist' }).click();
    await expect(page.getByText('Enrolled — we', { exact: false })).toBeVisible();

    // Clean up: deactivate the audit product
    await page.goto('/admin/products');
    page.on('dialog', (d) => d.accept());
    await page.getByRole('row', { name: new RegExp(dropName) }).getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('row', { name: new RegExp(dropName) }).getByText('inactive')).toBeVisible();
  });

  test('admin orders view lists webhook-created orders and updates status', async ({ page }) => {
    const guestEmail = uniqueEmail('guest-buyer');
    const status = await sendWebhook(page.request, orderPaidEvent(null, guestEmail, [{ p: 'p027', q: 1 }], 899));
    expect(status).toBe(200);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/orders');
    const orderCard = page.locator('.rx-card').filter({ hasText: guestEmail });
    await expect(orderCard).toBeVisible();
    await expect(orderCard.getByText('Classic MD', { exact: false })).toBeVisible();
    await orderCard.getByRole('combobox').selectOption('shipped');
    await page.reload();
    await expect(page.locator('.rx-card').filter({ hasText: guestEmail }).getByRole('combobox')).toHaveValue('shipped');
  });

  test('image-gen console renders all SKUs with generate buttons', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/image-gen');
    await expect(page.getByText('Flux Product Photography')).toBeVisible();
    expect(await page.getByRole('button', { name: /Generate & Publish|Regenerate & Publish/ }).count()).toBeGreaterThanOrEqual(34);
  });
});
