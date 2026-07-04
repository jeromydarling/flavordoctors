import { test, expect } from './fixtures';
import {
  uniqueEmail,
  ensureUser,
  loginViaUi,
  registerViaUi,
  sendWebhook,
  orderPaidEvent,
  subscriptionCreatedEvent,
  renewalInvoiceEvent,
  refundedEvent,
  currentUserId,
} from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';
const AFF_EMAIL = uniqueEmail('creator');
const AFF_NAME = `Creator ${Date.now().toString(36)}`;
let affRefCode: string; // hc_… link token
let affCode: string; // vanity discount code

/**
 * The House Call Network: application (fail-closed when AI is down) → human
 * approval → link + code provisioning → order/subscription attribution and
 * commission math → refund clawback → the self-maintaining library.
 * Locally the AI binding is off, so every AI feature must land on its
 * deterministic fallback.
 */
test.describe.serial('Affiliate program & library', () => {
  test('landing page pitches the program; anonymous visitors are sent to sign in', async ({ page }) => {
    await page.goto('/affiliates');
    await expect(page.getByRole('heading', { name: 'Prescribe flavor. Get paid.' })).toBeVisible();
    await expect(page.getByText('Chief of Medicine')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to apply' })).toBeVisible();

    // Comparison table: our column vs published alternatives
    await expect(page.getByRole('heading', { name: 'How we stack up' })).toBeVisible();
    const row = page.getByRole('row', { name: /First-order commission/ });
    await expect(row.getByText('25–30%')).toBeVisible();
    await expect(row.getByText('1%', { exact: true })).toBeVisible();

    // Scenario cards + live calculator with honest disclaimer
    await expect(page.getByText('The steady creator')).toBeVisible();
    const monthly = page.getByTestId('calc-monthly');
    await expect(monthly).toHaveText('$222'); // defaults: 10 orders + 3 subs
    await page.getByLabel(/One-time orders you send per month/).fill('100');
    await page.getByLabel(/New Rx Box subscribers per month/).fill('30');
    await expect(monthly).toHaveText('$2,215');
    await expect(page.getByTestId('calc-yearly')).toHaveText('$26,580');
    await expect(page.getByText('Earnings disclaimer:', { exact: false })).toBeVisible();
  });

  test('application validates, then queues for a human when AI is unavailable', async ({ page }) => {
    await registerViaUi(page, AFF_EMAIL);
    await page.goto('/affiliates');

    // Gate 1: a lazy application bounces with a specific reason
    await page.getByLabel('Your name').fill(AFF_NAME);
    await page.getByLabel('Where you post').fill('https://tiktok.com/@e2ecreator');
    await page.getByLabel("Who's your audience?").fill('food people');
    await page.getByLabel('How would you prescribe Flavor Doctors to them?').fill('I would post about it a lot honestly');
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Tell us about your audience', { exact: false })).toBeVisible();

    // A real application goes through — and with AI down it must QUEUE, not approve
    await page.getByLabel("Who's your audience?").fill('About 3k home cooks who meal prep on Sundays, mostly busy parents who want fast flavor.');
    await page
      .getByLabel('How would you prescribe Flavor Doctors to them?')
      .fill('A weekly "doctor the dinner" series where I fix one boring staple per episode using a single product, with my code in every caption.');
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Application received.', { exact: false })).toBeVisible();

    // Portal stays locked while pending
    await page.goto('/affiliates/portal');
    await expect(page.getByText('Credentials pending', { exact: false })).toBeVisible();
  });

  test('admin approves from the queue; link and code are provisioned', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/affiliates');
    const card = page.locator('div', { has: page.getByText(AFF_EMAIL) }).filter({ hasText: 'AI unavailable — human call' }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Done: approve.')).toBeVisible();

    // The new member's portal now shows their prescription pad
    await loginViaUi(page, AFF_EMAIL);
    await page.goto('/affiliates/portal');
    await expect(page.getByText(`Dr. ${AFF_NAME}`, { exact: false })).toBeVisible();
    const link = await page.locator('p.font-mono.text-sm').first().textContent();
    affRefCode = link!.split('?aff=')[1];
    expect(affRefCode).toMatch(/^hc_/);
    affCode = (await page.locator('p.font-mono.text-2xl').first().textContent())!.trim();
    expect(affCode).toMatch(/^[A-Z0-9]{4,18}$/);
  });

  test('?aff link click is tracked; first order pays 25%; self-purchases pay nothing', async ({ page }) => {
    // A shopper lands on the affiliate's link
    await page.goto(`/?aff=${affRefCode}`);
    await page.waitForTimeout(300); // click beacon

    const buyer = uniqueEmail('affbuyer');
    expect(
      await sendWebhook(page.request, orderPaidEvent(null, buyer, [{ p: 'p001', q: 3 }], 2997, { affiliateRef: affRefCode }))
    ).toBe(200);
    // Self-purchase attempt: the affiliate buying via their own link earns nothing
    expect(
      await sendWebhook(page.request, orderPaidEvent(null, AFF_EMAIL, [{ p: 'p001', q: 1 }], 999, { affiliateRef: affRefCode }))
    ).toBe(200);

    await loginViaUi(page, AFF_EMAIL);
    await page.goto('/affiliates/portal');
    const cards = page.locator('.rx-card');
    await expect(cards.filter({ hasText: 'Clicks (30d)' }).locator('p').nth(1)).toHaveText('1');
    await expect(cards.filter({ hasText: 'Orders driven' }).locator('p').nth(1)).toHaveText('1');
    // 25% of $29.97 = $7.49, held until the refund window passes
    await expect(cards.filter({ hasText: 'Pending earnings' }).locator('p').nth(1)).toHaveText('$7.49');
  });

  test('subscriptions earn on the first box and again on renewals', async ({ page }) => {
    const subscriber = uniqueEmail('affsub');
    await registerViaUi(page, subscriber);
    const uid = await currentUserId(page);
    const event = subscriptionCreatedEvent(uid, subscriber, 'signature', 'monthly', { affiliateRef: affRefCode });
    expect(await sendWebhook(page.request, event)).toBe(200);
    const stripeSubId = event.data.object.subscription;
    // A renewal invoice a month later earns the 10% recurring rate
    expect(await sendWebhook(page.request, renewalInvoiceEvent(stripeSubId, 5400))).toBe(200);

    await loginViaUi(page, AFF_EMAIL);
    await page.goto('/affiliates/portal');
    // $7.49 + 25% of $54 ($13.50) + 10% of $54 ($5.40) = $26.39
    await expect(page.locator('.rx-card').filter({ hasText: 'Pending earnings' }).locator('p').nth(1)).toHaveText('$26.39');
  });

  test('a refund claws the commission back before it ever clears', async ({ page }) => {
    const buyer = uniqueEmail('refundbuyer');
    const order = orderPaidEvent(null, buyer, [{ p: 'p001', q: 2 }], 1998, { affiliateRef: affRefCode });
    expect(await sendWebhook(page.request, order)).toBe(200);
    await loginViaUi(page, AFF_EMAIL);
    await page.goto('/affiliates/portal');
    // +25% of $19.98 = $5.00 (rounded) on top of $26.39
    await expect(page.locator('.rx-card').filter({ hasText: 'Pending earnings' }).locator('p').nth(1)).toHaveText('$31.39');

    expect(await sendWebhook(page.request, refundedEvent(order.data.object.payment_intent))).toBe(200);
    await page.reload();
    await expect(page.locator('.rx-card').filter({ hasText: 'Pending earnings' }).locator('p').nth(1)).toHaveText('$26.39');
  });

  test('the library self-populates from the catalog with the code baked in', async ({ page }) => {
    // Nightly reconciliation builds kits (AI down → template fallbacks)
    await page.request.get('/cdn-cgi/handler/scheduled?cron=0+16+*+*+*');

    await loginViaUi(page, AFF_EMAIL);
    await page.goto('/affiliates/portal');
    await expect(page.getByRole('heading', { name: /The Medical Library/ })).toBeVisible();
    // Playbooks carry the affiliate's live rates
    await page.getByText('How the money works (rates, tiers, payouts)').click();
    await expect(page.getByText('You earn 25% of every first order', { exact: false })).toBeVisible();
    // A product one-sheet opens with hooks and the personalized code in the Do list
    await page.getByRole('button', { name: /Ranch Rx/ }).first().click();
    await expect(page.getByText('Hooks')).toBeVisible();
    await expect(page.getByText(`Use your code ${affCode}`, { exact: false })).toBeVisible();
  });

  test('payout release runs safely (nothing cleared yet) and reports honestly', async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/affiliates');
    await page.getByRole('button', { name: /Release payouts/ }).click();
    await expect(page.getByText(/Payout run: 0 paid/)).toBeVisible();
    // The roster shows the affiliate's attributed numbers
    const row = page.getByRole('row', { name: new RegExp(AFF_NAME) });
    await expect(row.getByText('approved')).toBeVisible();
  });
});
