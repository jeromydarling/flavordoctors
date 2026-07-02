import { test, expect } from './fixtures';

test.describe('Public surface', () => {
  test('homepage renders hero, departments, featured products, and CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('The doctor is');
    await expect(page.getByRole('link', { name: 'Browse the Menu' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get the Monthly Rx Box' })).toBeVisible();
    await expect(page.getByText('Departments')).toBeVisible();
    // Featured products load from the API
    await expect(page.getByText('Most Prescribed')).toBeVisible();
    await expect(page.locator('a[href^="/product/"]').first()).toBeVisible();
    // Intake exam CTA
    await expect(page.getByRole('link', { name: /Intake Exam/ })).toBeVisible();
  });

  test('menu lists all 34 products and filters by collection', async ({ page }) => {
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: 'The Menu' })).toBeVisible();
    // Pricing-play banner chips
    await expect(page.getByText('Free shipping over $45')).toBeVisible();
    await expect(page.getByText('Any 3+ items: 15% off automatically')).toBeVisible();
    // All products
    await expect(page.getByRole('heading', { name: 'Ranch Rx' })).toBeVisible();
    const allCards = page.locator('a[href^="/product/"]');
    expect(await allCards.count()).toBeGreaterThanOrEqual(34);
    // Filter to butter (7 SKUs)
    await page.getByRole('button', { name: 'Doctored Butter' }).click();
    await expect(page.getByRole('heading', { name: 'Cowboy Compound' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ranch Rx' })).not.toBeVisible();
    expect(page.url()).toContain('collection=butter');
  });

  test('product detail shows prescription pad and price; add to cart works', async ({ page }) => {
    await page.goto('/product/truffle-treatment');
    await expect(page.getByRole('heading', { name: 'Truffle Treatment' })).toBeVisible();
    await expect(page.getByText('$14.99').first()).toBeVisible();
    await expect(page.getByText(/Doctor's Notes/)).toBeVisible();
    // AI is offline locally — the fallback prescription copy must render
    await expect(page.getByText(/Side effects:/)).toBeVisible();
    await page.getByRole('button', { name: '+ Add to Cart' }).click();
    // Cart drawer opens with the item
    await expect(page.getByRole('dialog')).toContainText('Truffle Treatment');
  });

  test('unknown product slug shows themed not-found state', async ({ page }) => {
    await page.goto('/product/does-not-exist');
    await expect(page.getByText('Prescription not found')).toBeVisible();
  });

  test('cart drawer: quantities, running totals, bundle and shipping nudges', async ({ page }) => {
    await page.goto('/product/ranch-rx');
    await page.getByRole('button', { name: '+ Add to Cart' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('$8.99').first()).toBeVisible(); // line price + total both show $8.99
    await expect(drawer.getByText(/Add 2 more items for 15% off/)).toBeVisible();
    // Bump quantity to 3 → bundle unlocked
    await drawer.getByLabel('Increase Ranch Rx').click();
    await drawer.getByLabel('Increase Ranch Rx').click();
    await expect(drawer.getByText(/Bundle bonus: 15% off/)).toBeVisible();
    await expect(drawer.getByText('$26.97')).toBeVisible();
    // Shipping nudge shows remaining amount
    await expect(drawer.getByText(/away from free shipping/)).toBeVisible();
    // Remove line
    await drawer.getByLabel('Remove Ranch Rx').click();
    await expect(drawer.getByText('Your cart is empty', { exact: false })).toBeVisible();
  });

  test('faq renders as patient information leaflet', async ({ page }) => {
    await page.goto('/faq');
    await expect(page.getByRole('main').getByText('Patient Information Leaflet')).toBeVisible();
    await expect(page.getByText('How does the Monthly Rx Box work?')).toBeVisible();
  });

  test('about page renders brand story', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'Our Story' })).toBeVisible();
    await expect(page.getByText('Our Oath')).toBeVisible();
  });

  test('404 route shows themed message', async ({ page }) => {
    await page.goto('/nonsense-page');
    await expect(page.getByText('Diagnosis: page not found', { exact: false })).toBeVisible();
  });

  test('trials page renders (empty state or drops)', async ({ page }) => {
    await page.goto('/trials');
    await expect(page.getByRole('heading', { name: 'Clinical Trials' })).toBeVisible();
    await expect(
      page.getByText('No trials currently enrolling.').or(page.getByText('Now enrolling').first())
    ).toBeVisible();
  });

  test('pharmacist widget opens and degrades gracefully without AI', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ask The Pharmacist' }).click();
    await expect(page.getByText("Pharmacy window's open", { exact: false })).toBeVisible();
    await page.getByPlaceholder('Describe your symptoms…').fill('my chicken is boring');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // AI offline locally → in-character error message, no crash
    await expect(page.getByText('The Pharmacist is with another patient', { exact: false })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('intake exam: anonymous user completes quiz and gets a prescription', async ({ page }) => {
    await page.goto('/intake-exam');
    await expect(page.getByText('Question 1 of 5')).toBeVisible();
    await page.getByRole('button', { name: 'Chronic boring dinners' }).click();
    await page.getByRole('button', { name: /Hot — bring the burn/ }).click();
    await page.getByRole('button', { name: /Savory — burgers/ }).click();
    await page.getByRole('button', { name: /Fearless/ }).click();
    await page.getByRole('button', { name: /Steaks, veggies & the grill/ }).click();
    // Diagnosis renders (AI offline → template fallback is fine)
    await expect(page.getByText('Official Diagnosis')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Your Prescription' })).toBeVisible();
    // Three prescribed products with add buttons
    expect(await page.getByRole('button', { name: '+ Add', exact: true }).count()).toBe(3);
    // Anonymous → nudge to sign in to save
    await expect(page.getByText('to save this diagnosis', { exact: false })).toBeVisible();
    // Fill entire prescription pushes all 3 into the cart
    await page.getByRole('button', { name: /Fill Entire Prescription/ }).click();
    await expect(page.getByRole('dialog').getByText(/Bundle bonus: 15% off/)).toBeVisible();
  });

  test('subscribe page: tiers, savings math, cadence toggle, auth gate', async ({ page }) => {
    await page.goto('/subscribe');
    await expect(page.getByRole('heading', { name: 'Starter Rx' })).toBeVisible();
    await expect(page.getByText('$39.00')).toBeVisible();
    await expect(page.getByText('$54.00')).toBeVisible();
    await expect(page.getByText('$69.00')).toBeVisible();
    await expect(page.getByText(/First box 20% off/)).toBeVisible();
    await expect(page.getByText(/Save ~\d+% vs à la carte/).first()).toBeVisible();
    // Cadence toggle
    await page.getByRole('button', { name: 'Every 2 months' }).click();
    await expect(page.getByText(/half the pace/)).toBeVisible();
    // Anonymous → redirected to login
    await page.getByRole('button', { name: 'Prescribe Starter Rx' }).click();
    await page.waitForURL('**/login');
  });

  test('account routes are auth-gated', async ({ page }) => {
    await page.goto('/account');
    await page.waitForURL('**/login');
    await page.goto('/account/customize');
    await page.waitForURL('**/login');
  });
});
