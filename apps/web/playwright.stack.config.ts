import { defineConfig, devices } from "@playwright/test";
import { ORIGIN } from "./stack/env.mjs";

// The connected app, end to end: the production build of the app in front of
// the real API and a fresh local D1, with synthetic accounts and no
// credentials. `stack/serve.mjs` sets it all up; `playwright.config.ts` covers
// the screens on their own against a demo build.
export default defineConfig({
  testDir: "./stack",
  // Journeys share one database and one API; each uses its own account.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "stack-report" }]]
    : [["list"]],
  outputDir: "stack-results",
  use: {
    baseURL: ORIGIN,
    // The offline shell is covered by the demo suite. Here every request
    // must reach the page, so tests can cut the network under it.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run build && node stack/serve.mjs",
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    // Lets the script stop the API and the preview it started.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
