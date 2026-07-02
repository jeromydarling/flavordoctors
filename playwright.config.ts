import { defineConfig } from '@playwright/test';

/**
 * E2E audit config. Expects the app running locally:
 *   npm run build && npx wrangler dev --port 8791
 * (see e2e/README notes — the AI binding must be disabled for offline dev,
 * and .dev.vars must define JWT_SECRET / STRIPE_WEBHOOK_SECRET)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // shared local D1 state — keep runs deterministic
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8791',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Use the environment's pre-installed Chromium when the default browser
    // revision isn't downloaded (e.g. sandboxed/offline CI).
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
});
