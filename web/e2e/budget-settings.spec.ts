import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("settings lists the fixed categories read-only", async ({ page }) => {
  await page.goto("/dashboard/budget/settings");
  await expect(page.getByRole("heading", { level: 1, name: "BUDGET SETTINGS" })).toBeVisible();

  await expect(page.getByText("Expense categories", { exact: true })).toBeVisible();
  await expect(page.getByText("Income categories", { exact: true })).toBeVisible();
  for (const name of ["food", "transportation", "bills & installments", "salary", "reimbursement"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }

  // The form is gone; tags stay editable.
  await expect(page.getByText("Add New Category")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Category" })).toHaveCount(0);
  await expect(page.getByText("Add New Tag")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Tag" })).toBeVisible();
});

test("a save refused for an old category refetches the picker and asks again", async ({ page }) => {
  await page.goto("/dashboard/budget/expenses");
  await expect(page.getByRole("heading", { level: 1, name: "Expenses" })).toBeVisible();

  await page.getByRole("button", { name: "Expense", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New expense" });
  await expect(dialog).toBeVisible();

  const description = unique("Category retry");
  await dialog.getByLabel("What was it?").fill(description);
  await dialog.getByLabel("Amount").fill("120");
  await dialog.getByRole("button", { name: "food", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "food", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Refuse the first save the way corefinance refuses a category id that is
  // no longer in the fixed list.
  let posts = 0;
  await page.route("**/api/budget/expenses", async (route) => {
    if (route.request().method() !== "POST" || posts++ > 0) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 400,
      headers: {
        "access-control-allow-origin": "http://localhost:3001",
        "access-control-allow-credentials": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({ error: "unknown category: pick one from the category list" }),
    });
  });
  const refetched = page.waitForResponse(
    (r) => r.url().endsWith("/api/budget/expense-categories") && r.request().method() === "GET",
  );

  await dialog.getByRole("button", { name: /^Add expense/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("That category is no longer available");
  await refetched;
  await expect(dialog.getByRole("button", { name: "food", exact: true })).toHaveAttribute("aria-pressed", "false");

  // Pick a current category and save for real.
  await dialog.getByRole("button", { name: "transportation", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "transportation", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/budget/expenses") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: /^Add expense/ }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await expect(dialog).toBeHidden();

  expect((await page.request.delete(`${api}/api/budget/expenses/${id}`)).ok()).toBe(true);
  await page.unrouteAll();
});
