import { defineConfig, devices } from "@playwright/test";

// Browser e2e against the disposable stack from scripts/e2e-up.sh (web on
// :3001, gateway :18080, coreban :16972, throwaway Postgres + ntfy). It is
// not part of `pnpm test`: start the stack first, then `pnpm e2e`.
//
// Slow reminder timing (late, skipped, quiet while Done) is covered by
// coreban's Go tests with an injected clock, not here.
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
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
