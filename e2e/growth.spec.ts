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

/**
 * Growth wave: points redemption (validation, cart UI, webhook deduction),
 * the referral loop end-to-end, cancel-flow save offers, one-click reorder.
 */
test.describe.serial('Points, referrals, save offers & reorder', () => {
  const MEMBER = uniqueEmail('points');
  let memberId: string;

  test('granted points surface as redeemable value in My Chart', async ({ page }) => {
    await registerViaUi(page, MEMBER);
    memberId = await currentUserId(page);
    await page.request.post('/api/auth/logout');
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const grant = await page.request.post('/api/admin/customers/points', {
      data: { email: MEMBER, delta: 1200, reason: 'e2e-redemption' },
    });
    expect(grant.status()).toBe(200);

    await loginViaUi(page, MEMBER);
    await expect(page.getByText('1200 pts')).toBeVisible();
    await expect(page.getByText('worth $10.00 at checkout')).toBeVisible(); // 1000 of 1200 redeemable
  });

  test('checkout validates redemption blocks and balance', async ({ page }) => {
    await loginViaUi(page, MEMBER);
    const items = [{ productId: 'p001', quantity: 2 }];
    const notBlock = await page.request.post('/api/checkout', { data: { items, redeemPoints: 300 } });
    expect(notBlock.status()).toBe(400);
    expect(((await notBlock.json()) as { error: string }).error).toContain('blocks of 500');
    const tooMany = await page.request.post('/api/checkout', { data: { items, redeemPoints: 2000 } });
    expect(tooMany.status()).toBe(400);
    expect(((await tooMany.json()) as { error: string }).error).toContain('Not enough points');
    // A valid redemption reaches Stripe, which the sandbox blocks — proving
    // validation passed and the coupon call was attempted.
    const valid = await page.request.post('/api/checkout', { data: { items, redeemPoints: 500 } });
    expect(valid.status()).toBe(502);
    expect(((await valid.json()) as { error: string }).error).toContain('Payment provider error');
  });

  test('cart drawer offers the redemption selector and shows the discount', async ({ page }) => {
    await loginViaUi(page, MEMBER);
    await page.goto('/product/ranch-rx');
    await page.getByRole('button', { name: '+ Add to Cart' }).click();
    const drawer = page.getByRole('dialog');
    // $9.99 cart → one 500-pt block fits
    await drawer.getByLabel(/Board Certification points/).selectOption('500');
    await expect(drawer.getByText('−$5.00')).toBeVisible();
    await expect(drawer.getByText('$4.99')).toBeVisible(); // discounted total
  });

  test('paid order with redeemed points deducts them idempotently', async ({ page }) => {
    await loginViaUi(page, MEMBER);
    const event = orderPaidEvent(memberId, MEMBER, [{ p: 'p001', q: 2 }], 1498, { redeemPoints: 500 });
    expect(await sendWebhook(page.request, event)).toBe(200);
    expect(await sendWebhook(page.request, event)).toBe(200); // replay must not double-deduct
    const loyalty = (await (await page.request.get('/api/account/loyalty')).json()) as { points: number };
    // 1200 granted − 500 redeemed + 14 earned on the $14.98 order
    expect(loyalty.points).toBe(714);
  });

  test('referral loop: link → sign-up → first order → both sides earn points', async ({ page }) => {
    const referred = uniqueEmail('friend');
    await loginViaUi(page, MEMBER);
    await expect(page.getByRole('heading', { name: 'Refer a Patient' })).toBeVisible();
    const referral = (await (await page.request.get('/api/account/referral')).json()) as { code: string; url: string };
    expect(referral.code).toMatch(/^[A-Z2-9]{6}$/);

    // The friend lands on a ?ref= link, then registers
    await page.request.post('/api/auth/logout');
    await page.goto(`/?ref=${referral.code}`);
    await registerViaUi(page, referred);
    const friendId = await currentUserId(page);

    // Friend's first paid order triggers both rewards
    expect(await sendWebhook(page.request, orderPaidEvent(friendId, referred, [{ p: 'p001', q: 1 }], 999))).toBe(200);
    const friendLoyalty = (await (await page.request.get('/api/account/loyalty')).json()) as { points: number };
    expect(friendLoyalty.points).toBe(509); // 500 welcome + 9 from the order

    await loginViaUi(page, MEMBER);
    const referrerLoyalty = (await (await page.request.get('/api/account/loyalty')).json()) as { points: number };
    expect(referrerLoyalty.points).toBe(1214); // 714 + 500 referral
    const stats = (await (await page.request.get('/api/account/referral')).json()) as { signups: number; converted: number };
    expect(stats.signups).toBeGreaterThanOrEqual(1);
    expect(stats.converted).toBeGreaterThanOrEqual(1);
  });

  test('cancel flow: save-offer ladder renders; Stripe calls degrade gracefully', async ({ page }) => {
    const subEmail = uniqueEmail('saveme');
    await registerViaUi(page, subEmail);
    const uid = await currentUserId(page);
    expect(await sendWebhook(page.request, subscriptionCreatedEvent(uid, subEmail, 'starter'))).toBe(200);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Cancel…' }).click();
    const modal = page.getByRole('dialog', { name: 'Cancel subscription' });
    await expect(modal.getByText('Skip the next box')).toBeVisible();
    await expect(modal.getByText('Pause for 2 months')).toBeVisible();
    await expect(modal.getByText('Take 20% off your next box')).toBeVisible();
    await expect(modal.getByText('Cancel my subscription')).toBeVisible();

    // Sandbox blocks Stripe — the discount path must fail loudly, not silently
    await modal.getByText('Take 20% off your next box').click();
    await expect(page.getByText('Payment provider error', { exact: false })).toBeVisible();

    // Ladder can be dismissed without side effects
    await page.getByRole('button', { name: 'Cancel…' }).click();
    await page.getByRole('button', { name: 'Never mind — keep my box' }).click();
    await expect(page.getByRole('dialog', { name: 'Cancel subscription' })).not.toBeVisible();
  });

  test('one-click reorder loads a past order into the cart', async ({ page }) => {
    const buyer = uniqueEmail('refill');
    await registerViaUi(page, buyer);
    const uid = await currentUserId(page);
    expect(
      await sendWebhook(page.request, orderPaidEvent(uid, buyer, [{ p: 'p001', q: 2 }, { p: 'p014', q: 1 }], 3497))
    ).toBe(200);

    await page.goto('/account');
    await page.getByRole('button', { name: /Refill this order/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Shopping cart' });
    await expect(drawer.getByText('Ranch Rx')).toBeVisible();
    await expect(drawer.getByText('Big Doc Sauce')).toBeVisible();
    // Quantities carried over: 2 + 1 = 3 items → bundle nudge kicks in
    await expect(drawer.getByText(/Bundle bonus/)).toBeVisible();
  });
});
