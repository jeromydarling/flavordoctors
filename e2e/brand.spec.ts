import { test, expect } from './fixtures';
import { ensureUser } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';

test.describe('Brand Studio & email compliance', () => {
  test('admin edits brand; preview renders through the shell', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/brand');

    await expect(page.getByRole('heading', { name: 'Brand Studio' })).toBeVisible();
    const tagline = page.locator('#brand-tagline');
    await expect(tagline).not.toHaveValue('');
    await tagline.fill('Prescription-strength flavor, now with E2E coverage.');
    await page.getByRole('button', { name: 'Save brand' }).click();
    await expect(page.getByText('Brand saved')).toBeVisible();

    // Preview endpoint renders the saved tagline inside the shell, with the
    // compliance footer (postal address + unsubscribe) present.
    const preview = await page.request.get('/api/admin/brand/preview?kind=marketing');
    expect(preview.status()).toBe(200);
    const html = await preview.text();
    expect(html).toContain('E2E coverage');
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('New Prague');

    // Restore the default tagline so repeated runs stay stable
    await tagline.fill('Prescription-strength flavor. Small-batch sauces & seasonings.');
    await page.getByRole('button', { name: 'Save brand' }).click();
    await expect(page.getByText('Brand saved')).toBeVisible();
  });

  test('unsubscribe is POST-only: GET never mutates', async ({ request }) => {
    // Invalid tokens: GET renders the in-character expired page…
    const bad = await request.get('/unsubscribe?token=not-a-real-token');
    expect(await bad.text()).toContain('Link expired');
    // …and POST (the RFC 8058 one-click shape) answers JSON, not HTML.
    const post = await request.post('/unsubscribe?token=not-a-real-token', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      data: 'List-Unsubscribe=One-Click',
    });
    expect(post.status()).toBe(200);
    expect(await post.json()).toEqual({ ok: false });
  });
});
