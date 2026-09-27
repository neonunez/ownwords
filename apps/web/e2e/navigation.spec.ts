import { expect, test } from "@playwright/test";

test.describe("navigating the two modes", () => {
  test("opens on Progress with the four Maintain tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/maintain\/progress$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Progress" }),
    ).toBeVisible();

    const bar = page.getByRole("navigation", { name: "Maintain" });
    await expect(bar.getByRole("link")).toHaveText([
      "Progress",
      "Lexicon",
      "Practice",
      "Flashcards",
    ]);
  });

  test("moves between tabs and keeps the address in step", async ({ page }) => {
    await page.goto("/maintain/progress");
    await page.getByRole("link", { name: "Lexicon" }).click();
    await expect(page).toHaveURL(/\/maintain\/lexicon$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Lexicon" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Practice", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Practice" }),
    ).toBeVisible();
  });

  test("keeps the tab bar on a pushed screen and comes back", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon");
    await page.getByRole("button", { name: /to make do with/ }).click();
    await expect(page).toHaveURL(/\/maintain\/lexicon\/e1$/);
    await expect(
      page.getByRole("navigation", { name: "Maintain" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Back to your Lexicon" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Lexicon" }),
    ).toBeVisible();
  });

  test("crosses modes only through the side panel", async ({ page }) => {
    await page.goto("/maintain/progress");
    await expect(page.getByRole("link", { name: "Course" })).toHaveCount(0);

    await page.getByRole("button", { name: "Open the side panel" }).click();
    const panel = page.getByRole("dialog", { name: "Ownwórds" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /Learn/ }).click();

    await expect(page).toHaveURL(/\/learn\/course$/);
    const bar = page.getByRole("navigation", { name: "Learn" });
    await expect(bar.getByRole("link")).toHaveText([
      "Course",
      "Practice",
      "Alphabet",
      "Reference",
    ]);
  });

  test("keeps settings on a page of their own, one row from the panel", async ({
    page,
  }) => {
    await page.goto("/learn/alphabet");
    await page.getByRole("button", { name: "Open the side panel" }).click();
    const panel = page.getByRole("dialog", { name: "Ownwórds" });
    await expect(
      panel.getByRole("list", { name: "Your languages" }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "Sign out" })).toHaveCount(
      0,
    );
    await expect(panel.getByRole("switch")).toHaveCount(0);
    await panel.getByRole("button", { name: /Settings/ }).click();

    await expect(page).toHaveURL(/\/learn\/settings$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
    await expect(panel).toBeHidden();
    // The tab bar stays the one the person came from, with no tab lit.
    const bar = page.getByRole("navigation", { name: "Learn" });
    await expect(bar).toBeVisible();
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(0);

    // Back returns to the screen the panel was opened from.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/learn\/alphabet$/);
  });

  test("goes from the panel straight to what is waiting", async ({ page }) => {
    await page.goto("/learn/alphabet");
    await page.getByRole("button", { name: "Open the side panel" }).click();
    const panel = page.getByRole("dialog", { name: "Ownwórds" });
    await panel.getByRole("button", { name: /Practice is due/ }).click();
    await expect(page).toHaveURL(/\/maintain\/practice$/);
    await expect(
      page.getByRole("navigation", { name: "Maintain" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open the side panel" }).click();
    await panel.getByRole("button", { name: /Carry on · Unit 3/ }).click();
    await expect(page).toHaveURL(/\/learn\/course\/u3$/);
  });

  test("closes the side panel with the phone back gesture", async ({
    page,
  }) => {
    await page.goto("/learn/course");
    await page.getByRole("button", { name: "Open the side panel" }).click();
    await expect(page.getByRole("dialog", { name: "Ownwórds" })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Ownwórds" })).toBeHidden();
    await expect(page).toHaveURL(/\/learn\/course$/);
  });

  test("opens a deep link straight onto its screen", async ({ page }) => {
    await page.goto("/learn/alphabet");
    await expect(
      page.getByRole("heading", { level: 1, name: "Alphabet" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "The Russian alphabet" })
        .getByRole("listitem"),
    ).toHaveCount(33);
  });
});
