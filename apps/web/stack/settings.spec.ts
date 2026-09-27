import { expect, test } from "@playwright/test";
import { onboard, signIn } from "./helpers";

// Settings against the real API: every change here is read back from the
// backend after a reload, not from the page's own memory.
test("changes languages and a preference in Settings, and the panel follows", async ({
  page,
  context,
  request,
}) => {
  // English and Spanish kept up; no language learned yet.
  await onboard(request, "settler", false);
  await signIn(context, "settler");
  await page.goto("/maintain/progress");

  await page.getByRole("button", { name: "Open the side panel" }).click();
  const panel = page.getByRole("dialog", { name: "Ownwórds" });
  // A new account has nothing waiting, and the panel says so plainly.
  await expect(panel.getByText("Nothing is due to practise.")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Carry on/ })).toHaveCount(0);
  await panel.getByRole("button", { name: /Settings/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
  await expect(page.getByText("settler@example.com")).toBeVisible();

  await page.getByRole("button", { name: "Change languages" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Languages" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "How well you speak Español" })
      .getByRole("radio", { name: "B2" }),
  ).toBeChecked();
  await page
    .getByRole("combobox", { name: "Add a language you speak" })
    .selectOption("de");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("group", { name: "How well you speak Deutsch" })
    .getByRole("radio", { name: "C1" })
    .check();
  await page
    .getByRole("combobox", { name: "Language to learn" })
    .selectOption("ru");
  await page.getByRole("button", { name: "Save languages" }).click();

  await expect(page.getByText("Your languages are saved.")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  const suggest = page.getByRole("switch", { name: "Suggest translations" });
  await expect(suggest).toBeChecked();
  // The switch moves at once; the reload waits for the backend to have it.
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/onboarding") &&
      response.request().method() === "PUT",
  );
  await suggest.click();
  await expect(suggest).not.toBeChecked();
  expect((await saved).ok()).toBe(true);

  await page.reload();
  const languages = page.getByRole("list", { name: "Your languages" });
  await expect(languages.getByText("Deutsch")).toBeVisible();
  await expect(languages.getByText("C1")).toBeVisible();
  await expect(languages.getByText("learning · A0")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Suggest translations" }),
  ).not.toBeChecked();

  // The course is now started, so the panel offers its first step.
  await page.goto("/maintain/progress");
  await page.getByRole("button", { name: "Open the side panel" }).click();
  await panel.getByRole("button", { name: /Carry on · Unit 1/ }).click();
  await expect(page).toHaveURL(/\/learn\/course\//);
  await expect(
    page.getByRole("heading", { name: /Unit 1 · Five familiar letters/ }),
  ).toBeVisible();
});
