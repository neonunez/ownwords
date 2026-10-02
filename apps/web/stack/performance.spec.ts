import { expect, test } from "@playwright/test";
import { api, onboard, signIn } from "./helpers";

test("warm lesson navigation reuses resolution and Next waits for ordered real acknowledgements", async ({
  page,
  context,
  request,
}) => {
  await onboard(request, "performance");
  await signIn(context, "performance");
  const reads: string[] = [];
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/v1/learning/")
    )
      reads.push(new URL(request.url()).pathname);
    if (request.method() === "PUT" && request.url().endsWith("/progress"))
      writes.push(request.postDataJSON().stepId as string);
  });
  await page.goto("/learn/course");
  await page.getByRole("button", { name: /Continue · Unit 1/ }).click();
  await expect(page.getByRole("list", { name: "Step 1 of 4" })).toBeVisible();
  expect(reads.filter((path) => path.endsWith("/courses"))).toHaveLength(1);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/learning/**/progress", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saving progress…" }),
  ).toBeDisabled();
  await expect(page.getByRole("list", { name: "Step 1 of 4" })).toBeVisible();
  await expect.poll(() => writes.length).toBe(1);
  release();
  await expect(page.getByRole("list", { name: "Step 2 of 4" })).toBeVisible();
  expect(writes).toEqual(["a0-familiar-alphabet", "a0-familiar-hear"]);
  expect(reads.filter((path) => path.endsWith("/courses"))).toHaveLength(1);
  await page.getByRole("button", { name: "Back to the course" }).click();
  await expect(
    page.getByRole("button", { name: /Continue · Unit 1.*Read the word/ }),
  ).toBeVisible();
  // Reload loses the memory cache: the real persisted progress must still resume there.
  await page.reload();
  await page.getByRole("button", { name: /Continue · Unit 1/ }).click();
  await expect(page.getByRole("list", { name: "Step 2 of 4" })).toBeVisible();
});

test("a different verified account in a same-origin tab evicts the old tab's private screen", async ({
  page,
  context,
  request,
}) => {
  await onboard(request, "performance");
  await onboard(request, "peer");
  for (const [account, text] of [
    ["performance", "performance-private-word"],
    ["peer", "peer-private-word"],
  ] as const) {
    await api(request, account, "POST", "/api/v1/lexicon/entries", {
      kind: "word",
      senses: [
        { equivalents: [{ languageTag: "en", text, status: "manual" }] },
      ],
    });
  }
  await signIn(context, "performance");
  await page.goto("/maintain/lexicon");
  await expect(
    page.getByRole("button", { name: /performance-private-word/ }),
  ).toBeVisible();
  await signIn(context, "peer");
  const peer = await context.newPage();
  await peer.goto("/maintain/lexicon");
  await expect(
    peer.getByRole("button", { name: /peer-private-word/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /performance-private-word/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign in with a passkey" }),
  ).toBeVisible();
  await peer.close();
});
