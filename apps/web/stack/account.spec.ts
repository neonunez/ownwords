import { expect, test } from "@playwright/test";
import { ADMIN_TOKEN, ORIGIN } from "./env.mjs";
import { onboard, signIn } from "./helpers";

test.describe("signing in and the first run", () => {
  test("asks a signed-out visitor to sign in, and says an invitation is needed", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    // Nothing behind the gate is rendered.
    await expect(
      page.getByRole("navigation", { name: "Maintain" }),
    ).toHaveCount(0);
  });

  test("refuses a wrong invitation code, and accepts a real one", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Email address" })
      .fill("invited@example.com");
    await page
      .getByRole("textbox", { name: "Invitation code" })
      .fill("not-a-real-invitation-code-at-all");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      /not valid for this email address/,
    );

    // The owner issues an invitation through the administration API.
    const issued = await request.post(`${ORIGIN}/api/v1/admin/invitations`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ email: "invited@example.com" }),
    });
    expect(issued.status()).toBe(201);
    const { data } = (await issued.json()) as { data: { code: string } };

    await page
      .getByRole("textbox", { name: "Invitation code" })
      .fill(data.code);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("status")).toHaveText(
      /Invitation accepted for invited@example.com/,
    );
  });

  test("sends Google sign-in to Google with this origin's callback", async ({
    page,
  }) => {
    // Stand in for Google, so nothing leaves the machine.
    let authorizeUrl = "";
    await page.route("https://accounts.google.com/**", async (route) => {
      authorizeUrl = route.request().url();
      await route.fulfill({
        contentType: "text/html",
        body: "<title>Google stand-in</title>",
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveTitle("Google stand-in");
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/auth/callback/google`,
    );
  });

  test("explains a Google sign-in that came back without an invitation", async ({
    page,
  }) => {
    await page.goto("/?error=invitation_required");
    await expect(page.getByRole("alert")).toHaveText(/no invitation yet/);
    await expect(page).toHaveURL(`${ORIGIN}/`);
  });

  test("walks a new account through the first run and keeps it", async ({
    page,
    context,
  }) => {
    await signIn(context, "newcomer");
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your languages" }),
    ).toBeVisible();
    const start = page.getByRole("button", { name: "Start" });
    await expect(start).toBeDisabled();

    await page
      .getByRole("group", { name: "English: how well you speak it" })
      .getByRole("button", { name: "Native" })
      .click();
    await page
      .getByRole("group", { name: "Español: how well you speak it" })
      .getByRole("button", { name: "B2" })
      .click();
    await page.getByRole("button", { name: "Русский" }).click();
    await start.click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Progress" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Progress" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open the side panel" }).click();
    const panel = page.getByRole("dialog", { name: "Ownwórds" });
    await expect(panel.getByText("newcomer@example.com")).toBeVisible();
    await expect(panel.getByText("learning · A0")).toBeVisible();
    await expect(panel.getByText("B2")).toBeVisible();
  });

  test("exports the account as a file", async ({ page, context, request }) => {
    await onboard(request, "exporter");
    await signIn(context, "exporter");
    await page.goto("/maintain/progress");
    await page.getByRole("button", { name: "Open the side panel" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export my data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^ownwords-export-.*\.json$/);
    const saved = await file.path();
    const { readFile } = await import("node:fs/promises");
    const exported = JSON.parse(await readFile(saved, "utf8")) as {
      format: string;
      account: { email: string };
    };
    expect(exported.format).toBe("ownwords-account-export/1");
    expect(exported.account.email).toBe("exporter@example.com");
  });

  test("signs out for good, and says so when a session ends mid-use", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "leaver");
    await signIn(context, "leaver");
    await page.goto("/maintain/lexicon");
    await expect(
      page.getByRole("heading", { level: 1, name: "Lexicon" }),
    ).toBeVisible();

    // The cookie disappears under the running app: the next read is refused.
    await context.clearCookies();
    await page.getByRole("link", { name: "Progress" }).click();
    await expect(page.getByText(/You have been signed out/)).toBeVisible();

    await signIn(context, "leaver");
    await page.goto("/maintain/progress");
    await page.getByRole("button", { name: "Open the side panel" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    // The session was revoked on the server, not just forgotten here.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
  });
});
