import { defineConfig, devices } from "@playwright/test";

// Smoke coverage of the screens runs against a demo build through `vite
// preview`, so the service worker, the manifest and a real bundle are
// exercised with deterministic sample data and no backend. The demo build is
// its own output (`demo-dist/`), never the app's; the connected app is
// covered end to end by `playwright.stack.config.ts`.
const PORT = 4173;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "phone",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run build:demo && npx vite preview --outDir demo-dist --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
