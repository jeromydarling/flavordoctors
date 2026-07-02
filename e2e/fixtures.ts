import { test as base, expect } from '@playwright/test';

/**
 * Hermetic test fixture: abort all requests leaving the app under test
 * (Google Fonts etc.), so `load` never hangs on external origins in
 * offline/sandboxed environments.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const appOrigin = new URL(baseURL ?? 'http://localhost:8791').origin;
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(appOrigin) || url.startsWith('data:')) return route.continue();
      return route.abort();
    });
    await use(page);
  },
});

export { expect };
