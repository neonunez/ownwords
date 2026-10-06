import { expect, test } from "@playwright/test";

test.describe("light and dark", () => {
  test("follows the system setting when nothing has been chosen", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/maintain/progress");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("remembers an explicit choice across a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/maintain/progress");

    await page.getByRole("button", { name: "Open the side panel" }).click();
    await page
      .getByRole("dialog", { name: "Ownwórds" })
      .getByRole("button", { name: /Settings/ })
      .click();
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // A chosen appearance outranks the system scheme, so both of the
    // per-scheme theme-colors paint the bars dark, even under a light system.
    const metas = page.locator('meta[name="theme-color"]');
    await expect(metas).toHaveCount(2);
    for (const meta of await metas.all()) {
      await expect(meta).toHaveAttribute("content", "#0a0a0a");
    }
  });

  test("keeps one theme-color per scheme while following the system", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/maintain/progress");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page.locator(
        'meta[name="theme-color"][media="(prefers-color-scheme: light)"]',
      ),
    ).toHaveAttribute("content", "#f8f8f8");
    await expect(
      page.locator(
        'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]',
      ),
    ).toHaveAttribute("content", "#0a0a0a");
  });

  test("paints a real background in both themes, never a borrowed one", async ({
    page,
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/maintain/lexicon");
      const background = await page
        .locator("body")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(background).not.toBe("rgba(0, 0, 0, 0)");
    }
  });
});
