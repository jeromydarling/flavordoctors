import { test, expect } from './fixtures';
import { uniqueEmail, registerViaUi, loginViaUi, sendWebhook, subscriptionCreatedEvent, currentUserId } from './helpers';

const EMAIL = uniqueEmail('acct');
const PW1 = 'password-e2e-1';
const PW2 = 'password-e2e-two';
const PW3 = 'password-e2e-three';

/**
 * Customer account management: profile settings, marketing consent,
 * change-password, the full forgot/reset loop (token exposed locally via
 * E2E_EXPOSE_TOKENS), and self-service deletion with the subscription guard.
 */
test.describe.serial('Account management', () => {
  test('preferred name and marketing consent persist', async ({ page }) => {
    await registerViaUi(page, EMAIL, PW1);
    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();

    await page.getByLabel('Preferred name').fill('Dr. Tester');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    const consent = page.getByRole('checkbox');
    const before = await consent.isChecked();
    await consent.click();
    await expect(consent).toBeChecked({ checked: !before });
    await page.reload();
    await expect(page.getByLabel('Preferred name')).toHaveValue('Dr. Tester');
    await expect(page.getByRole('checkbox')).toBeChecked({ checked: !before });
  });

  test('change password from settings, then sign in with the new one', async ({ page }) => {
    await loginViaUi(page, EMAIL, PW1);
    await page.getByLabel('Current password').fill(PW1);
    await page.getByLabel('New password').fill(PW2);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Password updated.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await loginViaUi(page, EMAIL, PW2);
  });

  test('wrong current password is rejected', async ({ page }) => {
    await loginViaUi(page, EMAIL, PW2);
    await page.getByLabel('Current password').fill('not-the-password');
    await page.getByLabel('New password').fill('whatever-else-1');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Current password is incorrect')).toBeVisible();
  });

  test('forgot → emailed link → reset → old link burned', async ({ page }) => {
    // The login page links to the flow
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByRole('button', { name: 'Send Reset Link' }).click();
    await expect(page.getByText('a reset link is on its way', { exact: false })).toBeVisible();

    // Grab the token the way the email would deliver it (exposed only when
    // E2E_EXPOSE_TOKENS=1, i.e. local/CI runs)
    const res = await page.request.post('/api/auth/forgot', { data: { email: EMAIL } });
    const { devToken } = (await res.json()) as { devToken?: string };
    expect(devToken).toBeTruthy();

    await page.goto(`/reset-password?token=${devToken}`);
    await page.getByLabel('New password').fill(PW3);
    await page.getByRole('button', { name: 'Set New Password' }).click();
    await expect(page.getByText('Password updated.')).toBeVisible();
    await page.getByRole('link', { name: 'Sign in with your new password' }).click();
    await loginViaUi(page, EMAIL, PW3);

    // Every outstanding token was burned by the reset
    const reuse = await page.request.post('/api/auth/reset', { data: { token: devToken, password: 'another-pass-1' } });
    expect(reuse.status()).toBe(400);
  });

  test('unknown emails get the same generic answer (no account probing)', async ({ page }) => {
    const res = await page.request.post('/api/auth/forgot', { data: { email: uniqueEmail('ghost') } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { devToken?: string; message?: string };
    expect(body.devToken).toBeUndefined();
    expect(body.message).toContain('If that email has an account');
  });

  test('active subscribers must cancel before deleting', async ({ page }) => {
    const subEmail = uniqueEmail('delsub');
    await registerViaUi(page, subEmail);
    const uid = await currentUserId(page);
    expect(await sendWebhook(page.request, subscriptionCreatedEvent(uid, subEmail, 'starter'))).toBe(200);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await page.getByLabel('Confirm password to delete account').fill(PW1);
    await page.getByRole('button', { name: 'Permanently delete' }).click();
    await expect(page.getByText('cancel it under Manage Billing first', { exact: false })).toBeVisible();
  });

  test('regular accounts can self-delete; the login stops working', async ({ page }) => {
    const delEmail = uniqueEmail('deluser');
    await registerViaUi(page, delEmail);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    await page.getByLabel('Confirm password to delete account').fill(PW1);
    await page.getByRole('button', { name: 'Permanently delete' }).click();
    await page.waitForURL('**/');

    const login = await page.request.post('/api/auth/login', { data: { email: delEmail, password: PW1 } });
    expect(login.status()).toBe(401);
  });
});
