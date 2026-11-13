import { defineConfig, devices } from "@playwright/test";

// Browser e2e against the disposable stack from scripts/e2e-up.sh (web on
// :3001, gateway :18080, coreban :16972, throwaway Postgres + ntfy). It is
// not part of `pnpm test`: start the stack first, then `pnpm e2e`.
//
// Slow reminder timing (late, skipped, quiet while Done) is covered by
// coreban's Go tests with an injected clock, not here.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  // One admin account is shared; each test works on its own board, but
  // serial runs keep failures easy to read.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /feed-share-files\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    // Sharing files needs the service worker, which needs a secure origin:
    // the e2e host is plain http, so Chromium is told to treat it as one.
    {
      name: "service-worker",
      testMatch: /feed-share-files\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        // The full Chromium build: the headless shell ignores the flag.
        channel: "chromium",
        launchOptions: { args: [`--unsafely-treat-insecure-origin-as-secure=${new URL(baseURL).origin}`] },
      },
    },
  ],
});
