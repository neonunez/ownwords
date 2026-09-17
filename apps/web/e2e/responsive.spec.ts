import { expect, test } from '@playwright/test';

const screens = [
  '/maintain/progress',
  '/maintain/lexicon',
  '/maintain/lexicon/e3',
  '/maintain/practice',
  '/learn/course',
  '/learn/alphabet',
  '/learn/reference',
];

test.describe('how the app sits on a screen', () => {
  test('never scrolls sideways, at either size', async ({ page }) => {
    for (const path of screens) {
      await page.goto(path);
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows sideways`).toBeLessThanOrEqual(1);
    }
  });

  test('fills the viewport on a phone, with no imitation device chrome', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Phone presentation only.');
    await page.goto('/maintain/progress');

    const frame = page.locator('.ow-app');
    const box = (await frame.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeCloseTo(viewport.width, 0);
    expect(await frame.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('0px');
    await expect(page.getByText('9:41')).toHaveCount(0);
  });

  test('keeps the phone measure and centres for review on a desktop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop review only.');
    await page.goto('/maintain/progress');

    const box = (await page.locator('.ow-app').boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeLessThan(viewport.width / 2);
    expect(box.x).toBeGreaterThan(100);
  });

  test('keeps every control at the 44px minimum', async ({ page }) => {
    for (const path of ['/maintain/lexicon', '/maintain/practice', '/learn/course']) {
      await page.goto(path);
      await page.waitForTimeout(150);
      const small = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [role="switch"]'),
        );
        return nodes
          .filter((node) => node.offsetParent !== null)
          .map((node) => ({
            name: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 40),
            height: node.getBoundingClientRect().height,
          }))
          .filter((entry) => entry.height > 0 && entry.height < 43.5);
      });
      expect(small, `${path} has controls under 44px`).toEqual([]);
    }
  });
});
