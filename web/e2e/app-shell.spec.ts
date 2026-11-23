import { expect, login, test } from "./fixtures";

test("a hard reload paints the shell before the session check", async ({ page }) => {
  await login(page);
  await page.route("**/api/auth/me", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  const navigation = page.goto("/dashboard/budget");
  await expect(page.getByTestId("dashboard-skeleton")).toBeVisible();
  await expect(page.getByText("Initializing...")).toHaveCount(0);
  await expect(page.getByText("CORE SYSTEM", { exact: true })).toBeVisible();
  await navigation;
  await expect(page.getByTestId("money-on-hand-card")).toBeVisible();
});

test("an expired session ends on login without showing dashboard data", async ({ page, context }) => {
  await login(page);
  await context.clearCookies();
  await page.goto("/dashboard/budget");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("money-on-hand-card")).toHaveCount(0);
  await expect(page.getByText("Initializing...")).toHaveCount(0);
});

test("opening the bare address while signed in goes to the dashboard", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await page.waitForURL("**/dashboard");
});

test("/login while signed in says so, and still offers the form to switch account", async ({ page }) => {
  await login(page);
  await page.goto("/login");
  await expect(page.getByText("You're already signed in as")).toBeVisible();
  await expect(page.getByRole("button", { name: "Access System" })).toBeVisible();
  await page.getByRole("link", { name: "Go to the dashboard" }).click();
  await page.waitForURL("**/dashboard");
});

test("a session check that can't reach the gateway keeps the owner signed in", async ({ page }) => {
  await login(page);
  let offline = true;
  await page.route("**/api/auth/me", (route) => (offline ? route.abort("internetdisconnected") : route.continue()));
  await page.goto("/dashboard/budget");
  await expect(page.getByTestId("dashboard-skeleton")).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page).toHaveURL(/\/dashboard\/budget/);
  offline = false;
  await expect(page.getByTestId("money-on-hand-card")).toBeVisible({ timeout: 10000 });
});
