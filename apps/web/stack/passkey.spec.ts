import { expect, test } from "@playwright/test";
import { onboard, signIn } from "./helpers";

// A virtual authenticator in Chromium stands in for a phone's passkey, so the
// whole WebAuthn ceremony runs locally against the real passkey endpoints.
// It proves the wiring, not Safari on an iPhone, which stays a device check.
test("adds a passkey after sign-in, then signs in with it alone", async ({
  page,
  context,
  request,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await onboard(request, "keyholder", false);
  await signIn(context, "keyholder");
  await page.goto("/maintain/progress");
  await page.getByRole("button", { name: "Open the side panel" }).click();
  await page
    .getByRole("button", { name: "Add a passkey on this device" })
    .click();
  await expect(
    page.getByText("Passkey added. Next time, sign in with it."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Progress" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open the side panel" }).click();
  await expect(page.getByText("keyholder@example.com")).toBeVisible();
});
