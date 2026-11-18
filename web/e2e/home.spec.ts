import { API_URL as api, expect, login, test } from "./fixtures";

test("admin home shows services and no fake vitals or dead actions", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");

  await expect(page.getByText("ACTIVE SERVICES", { exact: true })).toBeVisible();
  await expect(page.getByText("SYSTEM VITALS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("QUICK ACTIONS", { exact: true })).toHaveCount(0);
});

test("guest home is a welcome and never calls the admin service endpoints", async ({ page }) => {
  const serviceCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/services")) serviceCalls.push(request.url());
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Try Demo Mode (Guest Access)" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByText("WELCOME", { exact: true })).toBeVisible();

  for (const label of ["Budget", "Feed", "Draw", "Kanban"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await expect(page.getByText("ACTIVE SERVICES", { exact: true })).toHaveCount(0);
  await expect(page.getByText("SYSTEM VITALS", { exact: true })).toHaveCount(0);
  expect(serviceCalls).toEqual([]);
});

test("the old mock endpoints are gone", async ({ page }) => {
  await login(page);
  for (const path of ["system/stats", "legacy/services"]) {
    const res = await page.request.get(`${api}/api/${path}`);
    expect(res.status()).toBe(404);
  }
});
