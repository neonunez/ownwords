import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function checkScreen(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [role="switch"], input',
      ),
    )
      .filter((node) => node.offsetParent !== null)
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          name: (node.getAttribute("aria-label") ?? node.textContent ?? "")
            .trim()
            .slice(0, 30),
          width: box.width,
          height: box.height,
        };
      })
      .filter((entry) => entry.height < 43.5 || entry.width < 43.5),
  );
  expect(small).toEqual([]);
}

// The screens in front of the app are only reachable with a backend, so the
// demo suite's accessibility checks never see them.
test.describe("the screens before the app", () => {
  test("sign-in has no detectable violations, and full-size targets", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await checkScreen(page);
  });

  test("the first run has none either, in dark mode", async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(context, "firstrun");
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your languages" }),
    ).toBeVisible();
    await checkScreen(page);

    // Filled in, with a level still to choose and a course picked, it has
    // none either: every state of the one screen is checked, not only its
    // empty start.
    await page
      .getByRole("combobox", { name: "Add a language you speak" })
      .selectOption("uk");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Language to learn" })
      .selectOption("ru");
    await expect(
      page.getByText("Choose how well you speak Українська."),
    ).toBeVisible();
    await checkScreen(page);
  });

  test("the first run fits the narrowest phone, and works from the keyboard", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(context, "firstrun");
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your languages" }),
    ).toBeVisible();

    const add = page.getByRole("combobox", {
      name: "Add a language you speak",
    });
    await add.focus();
    await add.selectOption("fr");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Add", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    // The new language's level takes the keyboard; arrows choose within it.
    const levels = page.getByRole("group", {
      name: "How well you speak Français",
    });
    await expect(levels.getByRole("radio", { name: "Native" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(levels.getByRole("radio", { name: "B2" })).toBeChecked();
    await expect(
      page.getByText("At ease in most conversations."),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await checkScreen(page);
  });
});
