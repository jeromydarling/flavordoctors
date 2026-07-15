import { test, expect } from './fixtures';
import { ensureUser } from './helpers';

const ADMIN_EMAIL = 'jeromy.darling@gmail.com';
const ADMIN_PASSWORD = 'password-e2e-1';

// Locally no HIGGSFIELD_KEY/ELEVENLABS_API_KEY are set, so this exercises the
// honest degraded path: drafting works, generation is config-gated.
test.describe.serial('Video spots (config-gated)', () => {
  const productName = `E2E Spot Sauce ${Date.now().toString(36)}`;
  let spotId: string;

  test('drafting a spot works without any provider keys', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const create = await page.request.post('/api/admin/products', {
      data: {
        name: productName,
        collection: 'mayo',
        description: 'A test jar for animating.',
        price: 1200,
        isActive: true,
      },
    });
    expect(create.status()).toBe(201);
    const { product } = (await create.json()) as { product: { id: string } };

    // Brief → drafted spot with a motion prompt (template path — AI is off locally)
    const draft = await page.request.post('/api/admin/marketing/spots', {
      data: { brief: 'Launch the new jar, moody and appetizing', productId: product.id },
    });
    expect(draft.status()).toBe(201);
    spotId = ((await draft.json()) as { id: string }).id;

    const list = (await (await page.request.get('/api/admin/marketing/spots')).json()) as {
      spots: { id: string; status: string; motion_prompt: string | null }[];
      configured: { higgsfield: boolean; elevenlabs: boolean };
    };
    const spot = list.spots.find((s) => s.id === spotId);
    expect(spot?.status).toBe('drafting');
    expect(spot?.motion_prompt).toMatch(new RegExp(productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(list.configured.higgsfield).toBe(false);
  });

  test('the prompt is editable; submit and audio are honestly config-gated', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const edit = await page.request.put(`/api/admin/marketing/spots/${spotId}`, {
      data: { motionPrompt: 'Slow orbit around the jar, steam rising.', duration: 10 },
    });
    expect(edit.ok()).toBeTruthy();

    const submit = await page.request.post(`/api/admin/marketing/spots/${spotId}/submit`);
    expect(submit.status()).toBe(503);
    expect(((await submit.json()) as { error: string }).error).toContain('not configured');

    const audio = await page.request.post(`/api/admin/marketing/spots/${spotId}/audio`, {
      data: { voiceoverText: 'Take two spoonfuls daily.' },
    });
    expect(audio.status()).toBe(503);
    expect(((await audio.json()) as { error: string }).error).toContain('not configured');
  });

  test('the studio renders the spot with the unconfigured banner', async ({ page }) => {
    await ensureUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/marketing');

    await expect(page.getByRole('heading', { name: 'Video spots' })).toBeVisible();
    await expect(page.getByText('generation is off', { exact: false })).toBeVisible();

    const card = page.locator('.rx-card', { hasText: `${productName} spot` });
    await expect(card).toBeVisible();
    await expect(card.getByText('Draft — review the motion prompt, then submit')).toBeVisible();
    await expect(card.locator('textarea')).toHaveValue(/Slow orbit around the jar/);
    await expect(card.getByRole('button', { name: 'Generate video' })).toBeVisible();
  });
});
