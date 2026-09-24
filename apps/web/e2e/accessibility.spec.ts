import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const screens: [name: string, path: string][] = [
  ["Progress", "/maintain/progress"],
  ["Lexicon", "/maintain/lexicon"],
  ["Entry", "/maintain/lexicon/e3"],
  ["New entry", "/maintain/add"],
  ["Practice", "/maintain/practice"],
  ["Course", "/learn/course"],
  ["Lesson", "/learn/course/u3"],
  ["Alphabet", "/learn/alphabet"],
  ["Reference", "/learn/reference"],
];

test.describe("accessibility basics", () => {
  for (const [name, path] of screens) {
    test(`${name} has no detectable violations`, async ({ page }) => {
      await page.goto(path);
      // The screen is drawn, not merely loading, before it is measured.
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await page.waitForTimeout(200);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }

  test("the side panel has none either, in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/maintain/progress");
    await page.getByRole("button", { name: "Open the side panel" }).click();
    await expect(page.getByRole("dialog", { name: "Ownwórds" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("shows a visible focus ring on a keyboard tab", async ({ page }) => {
    await page.goto("/maintain/lexicon");
    await expect(
      page.getByRole("searchbox", { name: "Search your Lexicon" }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    const shadow = await page.evaluate(
      () => getComputedStyle(document.activeElement as HTMLElement).boxShadow,
    );
    expect(shadow).not.toBe("none");
  });

  test("keeps focus inside a sheet, and returns it when the sheet closes", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon/e1");
    const opener = page.getByRole("button", {
      name: /Fix the Русский equivalent/,
    });
    await opener.click();

    const sheet = page.getByRole("dialog", { name: "How well does it fit?" });
    await expect(sheet).toBeVisible();

    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      // Closed sheets stay mounted, inert; only the open one may hold focus.
      const inside = await sheet.evaluate((dialog) =>
        dialog.contains(document.activeElement),
      );
      expect(inside).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("reaches the whole Lexicon screen from the keyboard alone", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon");
    await expect(
      page.getByRole("searchbox", { name: "Search your Lexicon" }),
    ).toBeVisible();
    const names: string[] = [];
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      names.push(
        await page.evaluate(() => {
          const node = document.activeElement as HTMLElement | null;
          return (node?.getAttribute("aria-label") ?? node?.textContent ?? "")
            .trim()
            .slice(0, 30);
        }),
      );
    }
    expect(names).toContain("Add an entry");
    expect(names).toContain("Search your Lexicon");
    // The floating action comes after the screen and before the tab bar.
    expect(names.indexOf("Add an entry")).toBeLessThan(
      names.indexOf("Progress"),
    );
  });

  test("stands still when motion is reduced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/maintain/progress");
    const duration = await page
      .locator(".ow-screen")
      .evaluate((node) => getComputedStyle(node).animationDuration);
    expect(Number.parseFloat(duration)).toBeLessThan(0.05);
  });

  test("writes every state out, never leaving colour to carry it", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon/e3");
    const entry = page.locator("#ow-main");
    await expect(
      entry.getByText("false friend", { exact: true }),
    ).toBeVisible();
    await expect(entry.getByText("waiting", { exact: true })).toBeVisible();
    await expect(
      entry.getByText("exact", { exact: true }).first(),
    ).toBeVisible();
  });
});
