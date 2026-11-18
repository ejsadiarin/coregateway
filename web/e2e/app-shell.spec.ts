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
