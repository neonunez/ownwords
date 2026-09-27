import { expect, test, type Page } from "@playwright/test";

const screens = [
  "/maintain/progress",
  "/maintain/lexicon",
  "/maintain/lexicon/e3",
  "/maintain/practice",
  "/learn/course",
  "/learn/alphabet",
  "/learn/reference",
];

test.describe("how the app sits on a screen", () => {
  test("never scrolls sideways, at either size", async ({ page }) => {
    for (const path of screens) {
      await page.goto(path);
      // The screen is drawn, not merely loading, before it is measured.
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows sideways`).toBeLessThanOrEqual(1);
    }
  });

  test("fills the viewport on a phone, with no imitation device chrome", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "Phone presentation only.");
    await page.goto("/maintain/progress");

    const frame = page.locator(".ow-app");
    await expect(frame).toBeVisible();
    const box = (await frame.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeCloseTo(viewport.width, 0);
    expect(
      await frame.evaluate((node) => getComputedStyle(node).borderTopWidth),
    ).toBe("0px");
    await expect(page.getByText("9:41")).toHaveCount(0);
  });

  test("keeps the phone measure and centres for review on a desktop", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop review only.");
    await page.goto("/maintain/progress");

    await expect(page.locator(".ow-app")).toBeVisible();
    const box = (await page.locator(".ow-app").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeLessThan(viewport.width / 2);
    expect(box.x).toBeGreaterThan(100);
  });

  test("keeps every control at the 44px minimum", async ({ page }) => {
    for (const path of [
      "/maintain/lexicon",
      "/maintain/practice",
      "/learn/course",
    ]) {
      await page.goto(path);
      // The screen is drawn, not merely loading, before it is measured.
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await page.waitForTimeout(150);
      const small = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], [role="switch"]',
          ),
        );
        return nodes
          .filter((node) => node.offsetParent !== null)
          .map((node) => ({
            name: (node.getAttribute("aria-label") ?? node.textContent ?? "")
              .trim()
              .slice(0, 40),
            height: node.getBoundingClientRect().height,
          }))
          .filter((entry) => entry.height > 0 && entry.height < 43.5);
      });
      expect(small, `${path} has controls under 44px`).toEqual([]);
    }
  });
});

// An iPhone 16 or 17 Pro opened from the Home Screen: 402 by 874 points, a
// 62pt status bar the page draws under (black-translucent) and a 34pt home
// indicator. Chromium applies the insets itself, but it cannot open in
// standalone display mode or size a viewport the way WebKit does, so the
// served CSS models both: the standalone rules are switched on, and every
// 100dvh resolves short by `--model-dvh-shortfall`, as iOS 26 reports the
// dynamic viewport after such a launch until the first scroll (WebKit bug
// 301108). The large viewport stays whole, as it does there. This is a model
// of the iPhone, not an iPhone.
const iphone = { width: 402, height: 874, statusBar: 62, homeIndicator: 34 };

async function openAsIphone(
  page: Page,
  path: string,
  { standalone, shortfall }: { standalone: boolean; shortfall: number },
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: {
      top: iphone.statusBar,
      bottom: standalone ? iphone.homeIndicator : 0,
      left: 0,
      right: 0,
    },
  });

  const modelled = new Set<string>();
  await page.route("**/*.css", async (route) => {
    const response = await route.fetch();
    let css = await response.text();
    if (css.includes("100dvh")) {
      css = css.replaceAll(
        "100dvh",
        "calc(100dvh - var(--model-dvh-shortfall))",
      );
      modelled.add("100dvh");
    }
    const installed = /\(display-mode:\s*standalone\)/;
    if (standalone && installed.test(css)) {
      css = css.replace(installed, "all");
      modelled.add("standalone");
    }
    await route.fulfill({
      response,
      body: `${css}\n:root{--model-dvh-shortfall:${shortfall}px}`,
    });
  });

  await page.goto(path);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  // The model has to find what it replaces, or the test proves nothing.
  expect([...modelled].sort()).toEqual(
    standalone ? ["100dvh", "standalone"] : ["100dvh"],
  );
}

async function tabBarEdges(page: Page) {
  return page
    .getByRole("navigation")
    .first()
    .evaluate((bar) => ({
      bottom: bar.getBoundingClientRect().bottom,
      padding: getComputedStyle(bar).paddingBottom,
    }));
}

test.describe("opened from the iPhone Home Screen", () => {
  test.use({
    viewport: { width: iphone.width, height: iphone.height },
    deviceScaleFactor: 3,
    // Every stylesheet has to come through the model, never the cache.
    serviceWorkers: "block",
  });

  test("keeps the tab bar on the bottom edge from launch, through a scroll", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "Phone presentation only.");
    await openAsIphone(page, "/learn/alphabet", {
      standalone: true,
      shortfall: iphone.statusBar,
    });

    // Just after launch, while WebKit still reports the viewport short.
    let bar = await tabBarEdges(page);
    expect(bar.bottom).toBeCloseTo(iphone.height, 0);
    expect(bar.padding).toBe(`${iphone.homeIndicator}px`);

    const main = page.locator("#ow-main");
    const scrolled = await main.evaluate((node) => {
      node.scrollBy(0, 200);
      return node.scrollTop;
    });
    expect(scrolled, "the screen did not scroll").toBeGreaterThan(0);
    bar = await tabBarEdges(page);
    expect(bar.bottom).toBeCloseTo(iphone.height, 0);

    // WebKit catches up after the scroll; nothing moves when it does.
    await page.evaluate(() =>
      document.documentElement.style.setProperty(
        "--model-dvh-shortfall",
        "0px",
      ),
    );
    bar = await tabBarEdges(page);
    expect(bar.bottom).toBeCloseTo(iphone.height, 0);
  });

  test("still clears Safari's toolbar in a browser tab", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "Phone presentation only.");
    // In a tab the dynamic viewport is the part the toolbar leaves showing.
    const toolbar = 80;
    await openAsIphone(page, "/maintain/progress", {
      standalone: false,
      shortfall: toolbar,
    });

    const bar = await tabBarEdges(page);
    expect(bar.bottom).toBeCloseTo(iphone.height - toolbar, 0);
  });
});
