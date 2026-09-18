import { expect, test } from '@playwright/test';

test.describe('installing, and the offline shell', () => {
  test('serves a manifest that installs as a standalone app', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();

    const response = await request.get(href!);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toBe('Ownwords');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true);
  });

  test('declares the iOS home-screen metadata a PWA needs there', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /viewport-fit=cover/,
    );
  });

  test('registers a service worker and takes control', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 20_000,
    });
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  });

  test('opens its shell again with the network cut', async ({ page, context }) => {
    await page.goto('/maintain/lexicon');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 20_000,
    });
    // Give the precache time to settle before the network disappears.
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Lexicon' })).toBeVisible();
    await page.getByRole('link', { name: 'Practice', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
    await context.setOffline(false);
  });

  test('draws its own type offline, rather than fetching a webfont', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1')) external.push(request.url());
    });
    await page.goto('/maintain/progress');
    await page.waitForTimeout(500);
    expect(external).toEqual([]);

    const family = await page
      .locator('body')
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(family).toContain('Nunito');
  });

  test('clears older caches, so no stale shell can survive a new build', async ({ page }) => {
    await page.goto('/');
    const source = await page.evaluate(async () => (await fetch('/sw.js')).text());
    expect(source).toContain('cleanupOutdatedCaches');
    expect(source).toContain('clientsClaim');
    // A new build waits to be asked: the app posts SKIP_WAITING when the person
    // accepts the reload, rather than the worker taking over mid-session.
    expect(source).toContain('SKIP_WAITING');
  });
});
