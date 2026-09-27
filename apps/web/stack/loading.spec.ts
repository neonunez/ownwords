import { expect, test, type Locator, type Page } from "@playwright/test";
import { onboard, signIn } from "./helpers";

/** Holds every request matching `pattern` until the returned function is called. */
async function hold(page: Page, pattern: string): Promise<() => void> {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

/** Whether the element's transform changes over a moment: whether it moves. */
async function moves(element: Locator): Promise<boolean> {
  const at = () => element.evaluate((node) => getComputedStyle(node).transform);
  const first = await at();
  await element.page().waitForTimeout(600);
  return (await at()) !== first;
}

// A slow read is simulated by holding its request at the browser; the API
// answers normally once released. Screenshots are kept with the results as
// the visual record of each loading state.
test.describe("A read in flight, against the real backend", () => {
  test.beforeEach(async ({ context, request }) => {
    await onboard(request, "reader");
    await signIn(context, "reader");
  });

  test("Progress shows Kip reading until the progress arrives", async ({
    page,
  }, testInfo) => {
    const release = await hold(page, "**/api/v1/lexicon/progress**");
    await page.goto("/maintain/progress");

    const status = page
      .getByRole("status")
      .filter({ hasText: "Reading your progress." });
    await expect(status).toBeVisible();
    const eyes = status.locator(".ow-kip-read");
    await expect(eyes).toHaveCSS("animation-name", "ow-kip-read");
    expect(await moves(eyes)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("progress-loading.png"),
    });

    release();
    await expect(page.getByText(/There are no streaks/)).toBeVisible();
    await expect(status).toHaveCount(0);
  });

  test("the Lexicon reads under a search that stays usable, in dark", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const release = await hold(page, "**/api/v1/lexicon/entries**");
    await page.goto("/maintain/lexicon");

    await expect(
      page.getByRole("status").filter({ hasText: "Reading your Lexicon." }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search your Lexicon" }),
    ).toBeEditable();
    await page.screenshot({
      path: testInfo.outputPath("lexicon-loading-dark.png"),
    });

    release();
    await expect(page.getByText(/Your Lexicon is empty/)).toBeVisible();
  });

  test("the course reads with Kip still when motion is reduced", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const release = await hold(page, "**/api/v1/learning/courses**");
    await page.goto("/learn/course");

    const status = page
      .getByRole("status")
      .filter({ hasText: "Reading the course." });
    await expect(status).toBeVisible();
    const eyes = status.locator(".ow-kip-read");
    await expect(eyes).toHaveCSS("animation-name", "none");
    expect(await moves(eyes)).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("course-loading-reduced-motion.png"),
    });

    release();
    await expect(
      page.getByRole("button", { name: /Continue · Unit 1/ }),
    ).toBeVisible();
  });
});
