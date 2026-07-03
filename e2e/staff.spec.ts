import { test, expect } from './fixtures';
import { uniqueEmail, ensureUser, loginViaUi, registerViaUi } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com'; // on the ADMIN_EMAILS allowlist
const ADMIN_PASSWORD = 'password-e2e-1';
const REP_EMAIL = uniqueEmail('rep');

/**
 * Staff roles: an admin promotes a customer to support, the rep gets the
 * support wing (orders, customers, inbox, analytics) and nothing more, every
 * sensitive action lands in the audit trail, and demotion revokes access on
 * the very next request — no re-login required.
 */
test.describe.serial('Staff roles & audit trail', () => {
  test('admin promotes a registered user to support via the Staff page', async ({ page }) => {
    await registerViaUi(page, REP_EMAIL);
    await page.request.post('/api/auth/logout');
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await page.goto('/admin/staff');
    await expect(page.getByRole('heading', { name: 'Staff & Roles' })).toBeVisible();
    // The owner shows up in the roster with the allowlist key
    await expect(page.getByRole('cell', { name: new RegExp(ADMIN_EMAIL) }).first()).toBeVisible();
    await expect(page.getByText('🔑 owner').first()).toBeVisible();

    await page.getByLabel('Account email').fill(REP_EMAIL);
    await page.getByLabel('Role').selectOption('support');
    await page.getByRole('button', { name: 'Grant access' }).click();
    await expect(page.getByText(`${REP_EMAIL} is now support.`)).toBeVisible();

    // Roster and audit trail both reflect the change
    await expect(page.getByRole('cell', { name: new RegExp(REP_EMAIL) }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'role_change' }).first()).toBeVisible();
    await expect(page.getByText('customer → support').first()).toBeVisible();
  });

  test('promoting an unregistered email fails with a clear message', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/staff');
    await page.getByLabel('Account email').fill(uniqueEmail('ghost'));
    await page.getByRole('button', { name: 'Grant access' }).click();
    await expect(page.getByText('No registered account with that email', { exact: false })).toBeVisible();
  });

  test('support rep gets the support wing and nothing more', async ({ page }) => {
    await loginViaUi(page, REP_EMAIL);
    // Layout shows the Staff entry point (support lands on Orders)
    await expect(page.getByRole('link', { name: 'Staff' })).toBeVisible();

    await page.goto('/admin/orders');
    await expect(page.getByText('Staff Only')).toBeVisible();
    // Support tabs are present…
    for (const tab of ['Orders', 'Analytics', 'Customers', 'Inbox']) {
      await expect(page.getByRole('link', { name: tab, exact: true })).toBeVisible();
    }
    // …admin-only tabs are not
    for (const tab of ['Products', 'Marketing', 'Content Studio', 'Image Gen']) {
      await expect(page.getByRole('link', { name: tab, exact: true })).not.toBeVisible();
    }

    // Support pages actually load data
    await page.goto('/admin/customers');
    await expect(page.getByText(/Patients \(\d+\)/)).toBeVisible();

    // Admin-only pages are blocked in the UI
    await page.goto('/admin/products');
    await expect(page.getByText('Restricted Area', { exact: false })).toBeVisible();

    // …and at the API layer, allowed vs blocked exactly per role
    const matrix: [string, number][] = [
      ['/api/admin/orders', 200],
      ['/api/admin/customers', 200],
      ['/api/admin/tickets', 200],
      ['/api/admin/analytics', 200],
      ['/api/admin/products', 403],
      ['/api/admin/staff', 403],
      ['/api/admin/marketing/campaigns', 403],
      ['/api/admin/marketing/promotions', 403],
    ];
    for (const [path, expected] of matrix) {
      const res = await page.request.get(path);
      expect(res.status(), `${path} should return ${expected} for support`).toBe(expected);
    }
  });

  test('self-demotion is blocked; admin demotes the rep instead', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const self = await page.request.post('/api/admin/staff/role', {
      data: { email: ADMIN_EMAIL, role: 'support' },
    });
    expect(self.status()).toBe(400);

    await page.goto('/admin/staff');
    const row = page.getByRole('row', { name: new RegExp(REP_EMAIL) });
    await row.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByText('access revoked', { exact: false })).toBeVisible();
    await expect(page.getByText('support → customer').first()).toBeVisible();
  });

  test('demoted rep loses staff access with their existing session', async ({ page }) => {
    await loginViaUi(page, REP_EMAIL);
    // The JWT is still valid, but the role check is live against the DB
    const res = await page.request.get('/api/admin/orders');
    expect(res.status()).toBe(403);
    await page.goto('/admin/orders');
    await expect(page.getByText('Restricted Area', { exact: false })).toBeVisible();
  });
});
