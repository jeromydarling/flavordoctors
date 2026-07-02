import { test, expect } from './fixtures';
import {
  uniqueEmail,
  registerViaUi,
  loginViaUi,
  currentUserId,
  sendWebhook,
  orderPaidEvent,
  subscriptionCreatedEvent,
} from './helpers';

/**
 * The full patient journey: signup → quiz → cart → checkout (graceful Stripe
 * failure offline) → paid order via webhook → order history + ratings →
 * subscription via webhook → box customization → logout/login.
 */
test.describe.serial('Patient journey', () => {
  const email = uniqueEmail('patient');
  let userId: string;

  test('signup lands on My Chart with empty state', async ({ page }) => {
    await registerViaUi(page, email);
    await expect(page.getByRole('heading', { name: 'My Chart' })).toBeVisible();
    await expect(page.getByText(`Patient: ${email}`)).toBeVisible();
    // Loyalty starts at Patient tier, 0 pts
    await expect(page.getByText('0 pts', { exact: true })).toBeVisible();
    // No diagnosis, no subscription, no orders yet
    await expect(page.getByText('No diagnosis on file', { exact: false })).toBeVisible();
    await expect(page.getByText('No active subscription', { exact: false })).toBeVisible();
    await expect(page.getByText('No orders yet', { exact: false })).toBeVisible();
    userId = await currentUserId(page);
  });

  test('duplicate signup is rejected with clear message', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('password-e2e-1');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('already exists', { exact: false })).toBeVisible();
  });

  test('logged-in quiz saves the diagnosis to My Chart', async ({ page }) => {
    await loginViaUi(page, email);
    await page.goto('/intake-exam');
    await page.getByRole('button', { name: 'Frequent dessert emergencies' }).click();
    await page.getByRole('button', { name: /Mild — handle me gently/ }).click();
    await page.getByRole('button', { name: /Sweet — dessert is a food group/ }).click();
    await page.getByRole('button', { name: /The classics, done perfectly/ }).click();
    await page.getByRole('button', { name: /Desserts & breakfast treats/ }).click();
    await expect(page.getByText('Official Diagnosis')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Chronic Dessert Insufficiency' })).toBeVisible();

    await page.goto('/account');
    await expect(page.getByText('Diagnosis on file')).toBeVisible();
    await expect(page.getByText('Chronic Dessert Insufficiency')).toBeVisible();
  });

  test('checkout attempt surfaces a graceful payment error (Stripe unreachable offline)', async ({ page }) => {
    await loginViaUi(page, email);
    await page.goto('/product/big-doc-sauce');
    await page.getByRole('button', { name: '+ Add to Cart' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Fill Prescription/ }).click();
    // Offline sandbox: Stripe is unreachable → clear error, no crash, cart intact
    await expect(page.getByRole('dialog').getByText(/Payment provider error/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog').getByText('Big Doc Sauce')).toBeVisible();
  });

  test('paid order (via webhook) appears in order history with items', async ({ page }) => {
    const status = await sendWebhook(
      page.request,
      orderPaidEvent(userId, email, [{ p: 'p018', q: 1 }, { p: 'p021', q: 2 }], 3697)
    );
    expect(status).toBe(200);
    await loginViaUi(page, email);
    await expect(page.getByText('$36.97')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bourbon Street Drizzle' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dark Matter Fudge' })).toBeVisible();
    // Loyalty points awarded: floor(3697/100) = 36
    await expect(page.getByText('36 pts')).toBeVisible();
  });

  test('1-click rating persists across reloads', async ({ page }) => {
    await loginViaUi(page, email);
    const row = page.locator('li').filter({ hasText: 'Bourbon Street Drizzle' });
    await row.getByTitle('4 stars').click();
    await page.reload();
    // 4 gold stars for that product
    const stars = page.locator('li').filter({ hasText: 'Bourbon Street Drizzle' }).locator('button.text-gold');
    await expect(stars).toHaveCount(4);
  });

  test('subscription (via webhook) shows on My Chart with default best-seller box', async ({ page }) => {
    const status = await sendWebhook(page.request, subscriptionCreatedEvent(userId, email, 'standard', 'bimonthly'));
    expect(status).toBe(200);
    await loginViaUi(page, email);
    await expect(page.getByText('Standard Rx')).toBeVisible();
    await expect(page.getByText(/6 items · every 2 months/)).toBeVisible();
    await expect(page.getByText('active', { exact: true })).toBeVisible();
    // Points for the subscription payment: 36 + 54 = 90
    await expect(page.getByText('90 pts')).toBeVisible();
  });

  test('customize box: enforce exact item count, save selections', async ({ page }) => {
    await loginViaUi(page, email);
    await page.getByRole('link', { name: 'Customize My Box' }).click();
    await page.waitForURL('**/account/customize');
    // Default box preselected with 6 best-sellers
    await expect(page.getByText('Selected: 6 / 6')).toBeVisible();
    // Deselect one → save disabled at 5/6
    const selectedCard = page.locator('button:has(span:text("✓"))').first();
    await selectedCard.click();
    await expect(page.getByText('Selected: 5 / 6')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Treatment Plan' })).toBeDisabled();
    // Pick a different product (Lemon Aide is not a best-seller)
    await page.getByRole('button', { name: /Lemon Aide/ }).click();
    await expect(page.getByText('Selected: 6 / 6')).toBeVisible();
    await page.getByRole('button', { name: 'Save Treatment Plan' }).click();
    await expect(page.getByText('Treatment plan updated', { exact: false })).toBeVisible();
    // Persisted after reload
    await page.reload();
    await expect(page.getByText('Selected: 6 / 6')).toBeVisible();
    const lemonCard = page.getByRole('button', { name: /Lemon Aide/ });
    await expect(lemonCard.locator('span', { hasText: '✓' })).toBeVisible();
  });

  test('skip next box surfaces a graceful payment error offline', async ({ page }) => {
    await loginViaUi(page, email);
    await page.getByRole('button', { name: 'Skip Next Box' }).click();
    await expect(page.getByText(/Payment provider error/)).toBeVisible({ timeout: 15_000 });
  });

  test('logout returns to storefront; account requires login again', async ({ page }) => {
    await loginViaUi(page, email);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/');
    await page.goto('/account');
    await page.waitForURL('**/login');
  });

  test('wrong password is rejected', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible();
  });
});
