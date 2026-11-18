import { expect, login, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("services page shows built-in services with uptime and history", async ({ page }) => {
  await page.goto("/dashboard/services");

  for (const name of ["corefinance", "coreban", "coredraw"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("built-in", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("Hourly uptime, last 24 hours")).toHaveCount(3);
  await expect(page.getByLabel("Daily uptime, last 30 days")).toHaveCount(3);

  // Opening a row shows the recent checks.
  await page.getByText("corefinance", { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "corefinance" });
  await expect(dialog).toContainText("Recent Health Checks");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Built-ins can be paused and edited, never deleted.
  await page.getByRole("button", { name: "Actions for corefinance" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Pause" }).click();
  await expect(page.getByText("paused", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Actions for corefinance" }).click();
  await page.getByRole("menuitem", { name: "Resume" }).click();
  await expect(page.getByText("paused", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Actions for corefinance" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Service" });
  await expect(edit.getByLabel("URL")).toHaveAttribute("readonly");
  await expect(edit).toContainText("config owns this URL");
  await edit.getByRole("button", { name: "Cancel" }).click();
});

test("admins can add and delete a custom service, and the page fits a phone", async ({ page }) => {
  const name = `homelab ${Date.now().toString(36)}`;
  page.on("dialog", (dialog) => dialog.accept());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/services");
  await page.getByRole("button", { name: "Add Service" }).click();
  const dialog = page.getByRole("dialog", { name: "Add New Service" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("URL").fill("http://localhost:1/health");
  await dialog.getByRole("button", { name: "Add Service" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
