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
  });
});
