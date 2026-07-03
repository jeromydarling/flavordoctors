import { test, expect } from './fixtures';
import { uniqueEmail, ensureUser, loginViaUi, sendWebhook, orderPaidEvent } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';

test.describe.serial('Customer OS & Front Desk', () => {
  const customerEmail = uniqueEmail('crm-patient');
  let ticketSubject = '';

  test('front desk bot degrades gracefully offline and offers the human path', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ask the Clinic' }).click();
    await page.getByRole('button', { name: '🩺 Front Desk' }).click();
    await expect(page.getByText('Front Desk here', { exact: false })).toBeVisible();
    await page.getByPlaceholder(/Ask about orders/).fill('Where is my order?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // AI offline → degraded reply + escalation form appears
    await expect(page.getByText('a human can help', { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Open a ticket for a human')).toBeVisible();
    // Submit the escalation as a guest
    ticketSubject = 'Where is my order?';
    await page.locator('input[type="email"]').last().fill(customerEmail);
    await page.getByRole('button', { name: /Page the Doctor/ }).click();
    await expect(page.getByText('Ticket opened', { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  test('admin inbox: ticket visible with transcript, reply + close round-trip', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/inbox');
    const item = page.getByRole('button', { name: new RegExp(ticketSubject) }).first();
    await expect(item).toBeVisible();
    await item.click();
    // Thread shows customer message + bot transcript
    await expect(page.getByText('Chat transcript', { exact: false })).toBeVisible();
    // Reply (emails via local simulator)
    await page.getByPlaceholder(/Reply \(emailed/).fill('Your order ships tomorrow — Dr. Flavor');
    await page.getByRole('button', { name: 'Send Reply' }).click();
    await expect(page.getByText('Reply sent + emailed.')).toBeVisible();
    await expect(page.getByText('Your order ships tomorrow', { exact: false })).toBeVisible();
    // Close it
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Ticket closed.')).toBeVisible();
  });

  test('customer sees the ticket thread in My Chart', async ({ page }) => {
    await ensureUser(page, customerEmail);
    await page.goto('/account');
    await expect(page.getByText('Support Tickets')).toBeVisible();
    await page.locator('summary', { hasText: ticketSubject }).click();
    await expect(page.getByText('Your order ships tomorrow', { exact: false })).toBeVisible();
  });

  test('customers list: lifecycle stages, search, and the full customer file', async ({ page, request }) => {
    // Give the CRM patient an order so they classify as a customer
    await sendWebhook(request, orderPaidEvent(null, customerEmail, [{ p: 'p001', q: 2 }], 1998));
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/customers');
    await expect(page.getByText(/Patients \(\d+\)/)).toBeVisible();
    // Search narrows to our patient
    await page.getByPlaceholder('Search email…').fill(customerEmail);
    await expect(page.getByRole('cell', { name: customerEmail })).toBeVisible();
    // Open the customer file
    await page.getByRole('cell', { name: customerEmail }).click();
    await expect(page.getByRole('heading', { name: customerEmail })).toBeVisible();
    await expect(page.getByText('$19.98 LTV', { exact: false })).toBeVisible();
    // Ticket appears in the file
    await expect(page.getByText(ticketSubject).first()).toBeVisible();
    // Add a note
    await page.getByPlaceholder('Add a note…').fill('Prefers extra heat. Send Seoul Spice sample.');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Note added.')).toBeVisible();
    await expect(page.getByText('Prefers extra heat', { exact: false })).toBeVisible();
    // Grant loyalty points (registered account exists from the previous test)
    await page.getByRole('button', { name: 'Grant points' }).click();
    await expect(page.getByText('Points granted.')).toBeVisible();
    // One-off email (local simulator)
    await page.getByPlaceholder('Email subject').fill('A gift from the clinic');
    await page.getByPlaceholder(/Message \(plain text\)/).fill('We added 50 loyalty points to your chart. Get well soon.');
    await page.getByRole('button', { name: 'Send one-off email' }).click();
    await expect(page.getByText('Email sent.')).toBeVisible();
  });

  test('granted points show up in the customer loyalty balance', async ({ page }) => {
    await loginViaUi(page, customerEmail);
    // 50 granted points (order was a guest checkout, so only the grant counts)
    await expect(page.getByText('50 pts', { exact: true })).toBeVisible();
  });
});
