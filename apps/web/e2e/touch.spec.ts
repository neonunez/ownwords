import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * The phone layer, driven by real touch input through Chromium's DevTools
 * protocol, so `touch-action`, pointer capture and the browser's own scroll
 * all take part. Emulation is not an iPhone: sticky hover, rubber-banding,
 * the keyboard and the safe areas still need the real device.
 */

test.describe("on a touch screen", () => {
  test.skip(({ isMobile }) => !isMobile, "Touch input only.");

  /** One finger: down at `from`, through `steps` moves, up at `to`. */
  async function touch(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    { steps = 8, holdMs = 0, stepMs = 16, restMs = 0 } = {},
  ) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [from],
    });
    if (holdMs) await page.waitForTimeout(holdMs);
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
          },
        ],
      });
      await page.waitForTimeout(stepMs);
    }
    if (restMs) await page.waitForTimeout(restMs);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }

  async function centre(target: Locator) {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  test("opens a Lexicon row's options on a long press, not the entry", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon");
    const row = page.getByRole("button", { name: /^sobremesa/ });
    await expect(row).toBeVisible();
    const at = await centre(row);

    await touch(page, at, at, { steps: 0, holdMs: 700 });
    const sheet = page.getByRole("dialog", { name: "sobremesa" });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/\/maintain\/lexicon$/);
    await expect(
      sheet.getByRole("button", { name: "Open the entry" }),
    ).toBeVisible();

    // Dragged down by its head, the sheet goes away.
    const head = await centre(sheet.getByRole("heading"));
    await touch(page, head, { x: head.x, y: head.y + 320 });
    await expect(sheet).toBeHidden();

    // A quick tap still opens the entry.
    await row.tap();
    await expect(page).toHaveURL(/\/maintain\/lexicon\/e\d+$/);
  });

  test("lets a finger scroll the Lexicon without opening anything", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon");
    const row = page.getByRole("button", { name: /^sobremesa/ });
    await expect(row).toBeVisible();
    const at = await centre(row);

    await touch(page, at, { x: at.x, y: at.y - 200 }, { steps: 10 });
    await page.waitForTimeout(700);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/maintain\/lexicon$/);
  });

  test("grades a turned flashcard with a swipe", async ({ page }) => {
    await page.goto("/maintain/flashcards");
    const card = page.getByRole("button", { name: /Tap to turn it over/ });
    await expect(card).toBeVisible();
    const at = await centre(card);

    // Before it is turned, a swipe grades nothing. It ends at rest: a tap
    // straight after a flick only stops the flick, as on any phone.
    await touch(page, at, { x: at.x + 220, y: at.y }, { restMs: 150 });
    await expect(page.getByText("1 of 3 due")).toBeVisible();

    await card.tap();
    await expect(page.getByRole("button", { name: "Got it" })).toBeVisible();
    await touch(page, at, { x: at.x + 220, y: at.y });
    await expect(page.getByText("2 of 3 due")).toBeVisible();
  });

  test("puts the side panel away with a swipe toward its edge", async ({
    page,
  }) => {
    await page.goto("/maintain/progress");
    await page.getByRole("button", { name: "Open the side panel" }).tap();
    const panel = page.getByRole("dialog", { name: "Ownwórds" });
    await expect(panel).toBeVisible();
    const at = await centre(panel.getByRole("heading", { name: "Ownwórds" }));

    await touch(page, at, { x: at.x - 220, y: at.y });
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(/\/maintain\/progress$/);
  });
});

test.describe("the phone layer", () => {
  test("keeps every field at 16px, so focusing one never zooms the page", async ({
    page,
  }) => {
    for (const path of [
      "/maintain/lexicon",
      "/maintain/add",
      "/maintain/practice",
      "/maintain/languages",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await page.waitForTimeout(150);
      const small = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>("input, select, textarea"),
        )
          .filter((node) => node.offsetParent !== null)
          .filter(
            (node) => Number.parseFloat(getComputedStyle(node).fontSize) < 16,
          )
          .map(
            (node) => node.getAttribute("name") ?? node.outerHTML.slice(0, 60),
          ),
      );
      expect(small, `${path} has fields under 16px`).toEqual([]);
    }
  });

  test("keeps every hover style behind a real hover", async ({ page }) => {
    await page.goto("/maintain/progress");
    const ungated = await page.evaluate(() => {
      const found: string[] = [];
      const walk = (rules: CSSRuleList, gated: boolean) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule) {
            walk(
              rule.cssRules,
              gated || /hover:\s*hover/.test(rule.conditionText),
            );
          } else if (
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes(":hover") &&
            !gated
          ) {
            found.push(rule.selectorText);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets))
        walk(sheet.cssRules, false);
      return found;
    });
    expect(ungated).toEqual([]);
  });

  test("stops the pull-to-refresh at the root and the tap delay on controls", async ({
    page,
  }) => {
    await page.goto("/maintain/lexicon");
    await expect(page.getByRole("navigation").first()).toBeVisible();
    const read = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).overscrollBehaviorY,
      button: getComputedStyle(document.querySelector("button")!).touchAction,
      tab: getComputedStyle(document.querySelector("nav a")!).touchAction,
      tabSelect: getComputedStyle(document.querySelector("nav a")!).userSelect,
      body: getComputedStyle(document.body).userSelect,
    }));
    expect(read.root).toBe("none");
    expect(read.button).toBe("manipulation");
    expect(read.tab).toBe("manipulation");
    expect(read.tabSelect).toBe("none");
    // What a person reads stays selectable.
    expect(read.body).not.toBe("none");
  });

  test("asks for the whole screen, edge to edge, and never disables zoom", async ({
    page,
  }) => {
    await page.goto("/maintain/progress");
    const viewport = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });
});
