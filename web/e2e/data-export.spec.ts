import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const today = () => new Date().toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await login(page);
});

// Export, then import the same file back: every row is already yours, so a
// check and the import both report everything as already here.
test("export downloads a bundle that imports back with nothing new", async ({ page }) => {
  const res = await page.request.post(`${api}/api/budget/expenses`, {
    data: { amount: 42, currency: "PHP", description: unique("Export"), expense_date: today(), priority: "want", status: "posted", is_debt: false },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const id = ((await res.json()) as { id: string }).id;

  try {
    await page.goto("/dashboard/settings#data");
    await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeVisible();
    // Import and export left the Budget section.
    await expect(page.locator("#budget").getByRole("button", { name: /export/i })).toHaveCount(0);

    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await exporting;
    expect(download.suggestedFilename()).toMatch(/^coregateway-export-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await readFile(await download.path());
    const bundle = JSON.parse(file.toString());
    expect(bundle.format).toBe("coregateway.export");
    expect(bundle.parts.budget.format).toBe("coregateway.budget");
    expect(bundle.parts.budget.data.expenses.some((e: { id: string }) => e.id === id)).toBe(true);
    expect(bundle.parts.kanban.format).toBe("coregateway.kanban");

    await page.getByLabel("Export file").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: file });
    const parts = page.getByRole("group", { name: "Parts to import" });
    await expect(parts.getByRole("checkbox", { name: /Budget/ })).toBeChecked();
    await expect(parts.getByRole("checkbox", { name: /Kanban/ })).toBeChecked();

    await page.getByRole("button", { name: "Check" }).click();
    const result = page.getByTestId("import-result-budget");
    await expect(result).toContainText("Would import");
    await expect(page.getByText("Check: nothing was written")).toBeVisible();
    await expect(result.getByText("0 new").first()).toBeVisible();

    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(result).toContainText("Imported");
    await expect(result.getByText("expenses", { exact: true })).toBeVisible();
    await expect(result).not.toContainText(/[1-9]\d* new/);
    await expect(page.getByTestId("import-result-kanban")).toContainText("Imported");
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});

// An export from before versions (the budget's own rows) still imports.
test("an unversioned budget export imports from the Data section", async ({ page }) => {
  const id = randomUUID();
  const description = unique("Old export");
  const old = {
    expense_categories: [],
    income_categories: [],
    tags: [],
    expenses: [{ id, amount: "7", currency: "PHP", exchange_rate: "1", amount_php: "7", rate_date: today(), description, expense_date: today(), priority: "want", status: "posted", is_debt: false }],
    incomes: [],
    recurring_expenses: [],
    recurring_incomes: [],
    expense_tags: [],
    income_tags: [],
  };

  try {
    await page.goto("/dashboard/settings#data");
    await page.getByLabel("Export file").setInputFiles({ name: "budget_export.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
    await expect(page.getByText("An older export, from before versions")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const result = page.getByTestId("import-result-budget");
    await expect(result).toContainText("Imported");
    await expect(result.getByText("1 new")).toBeVisible();

    await page.goto("/dashboard/budget/expenses");
    await expect(page.getByText(description).first()).toBeVisible();
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});

test("a file that isn't an export is refused before upload", async ({ page }) => {
  await page.goto("/dashboard/settings#data");
  await page.getByLabel("Export file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from(`{"hello":"world"}`) });
  await expect(page.getByText("This file isn't an export.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check" })).toHaveCount(0);
});
