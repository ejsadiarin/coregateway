import type { Page } from "@playwright/test";

import { API_URL as api, expect, login, test } from "./fixtures";

// Expense and income notes: the record lives in corefinance, the note in
// coreban (coreban#16). Changes made "elsewhere" go straight to
// corefinance's API with the page's own session, as the Expenses page does.

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });
// The Feed's own capture buttons, not the nav's "Budget" link.
const captureButton = (page: Page, name: string) => page.getByRole("main").getByRole("button", { name, exact: true });

async function noteAction(page: Page, text: string, action: string) {
  await noteItem(page, text).getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

// captureExpense types description into the chat box and saves it as an
// expense of amount through + Budget, returning the expense's id.
async function captureExpense(page: Page, description: string, amount: string): Promise<string> {
  await page.getByRole("textbox", { name: "New note" }).fill(description);
  await captureButton(page, "Budget").click();
  const dialog = page.getByRole("dialog", { name: "New expense" });
  await expect(dialog.getByLabel("Description")).toHaveValue(description);
  await dialog.getByLabel("Amount").fill(amount);
  const created = page.waitForResponse((r) => r.url().endsWith("/api/budget/expenses") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create Expense" }).click();
  const { id } = await (await created).json();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
  return id;
}

const expenseStatus = async (page: Page, id: string) =>
  (await page.request.get(`${api}/api/budget/expenses/${id}`)).status();

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/feed");
  await expect(page.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
});

test("+ Budget captures an expense shown live; editing or deleting it elsewhere shows in its note", async ({ page }) => {
  const lunch = unique("Lunch");
  const id = await captureExpense(page, lunch, "250");
  await expect(noteItem(page, lunch)).toContainText(`₱250.00 · ${lunch}`);

  // Edited on the Expenses page: the note shows the change.
  const current = await (await page.request.get(`${api}/api/budget/expenses/${id}`)).json();
  const res = await page.request.put(`${api}/api/budget/expenses/${id}`, {
    data: { ...current, description: `${lunch} with drinks`, amount: 320 },
  });
  expect(res.ok()).toBe(true);
  await page.reload();
  await expect(noteItem(page, `${lunch} with drinks`)).toContainText("₱320.00");

  // Deleted there: the note stays, "(deleted)", showing its last content,
  // and keeps it on the next load as its snapshot.
  expect((await page.request.delete(`${api}/api/budget/expenses/${id}`)).ok()).toBe(true);
  await page.reload();
  await expect(noteItem(page, `${lunch} with drinks`)).toContainText(`₱320.00 · ${lunch} with drinks (deleted)`);
  await page.evaluate(() => localStorage.removeItem("coreban.feed.shown"));
  await page.reload();
  await expect(noteItem(page, `${lunch} with drinks`)).toContainText(`₱320.00 · ${lunch} with drinks (deleted)`);
});

test("archiving an expense's note deletes the expense first, after naming it", async ({ page }) => {
  const taxi = unique("Taxi");
  const id = await captureExpense(page, taxi, "180");

  await noteAction(page, taxi, "Archive");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`delete its expense “${taxi}” (₱180.00)`);
  await confirm.getByRole("button", { name: "Archive" }).click();
  await expect(noteItem(page, taxi).getByRole("button", { name: /Archived/ })).toBeVisible();
  expect(await expenseStatus(page, id)).toBe(404);

  await page.reload();
  await noteItem(page, taxi).getByRole("button", { name: /Archived/ }).click();
  await expect(noteItem(page, taxi)).toContainText(`₱180.00 · ${taxi} (deleted)`);
});

test("going offline between the two archive steps leaves the expense gone and the note deleted", async ({ page }) => {
  const coffee = unique("Coffee");
  const id = await captureExpense(page, coffee, "95");

  // The expense is deleted; archiving the note never reaches coreban.
  await page.route("**/api/coreban/notes/*", (route) =>
    route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue(),
  );
  await noteAction(page, coffee, "Archive");
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Failed to fetch")).toBeVisible();
  expect(await expenseStatus(page, id)).toBe(404);

  await page.unrouteAll();
  await page.reload();
  const note = noteItem(page, coffee);
  await expect(note).toContainText(`₱95.00 · ${coffee} (deleted)`);
  await expect(note.getByRole("button", { name: /Archived/ })).toHaveCount(0);
});

test("+ Budget switches to income, and tapping its note edits it in corefinance", async ({ page }) => {
  const salary = unique("Salary");
  await page.getByRole("textbox", { name: "New note" }).fill(salary);
  await captureButton(page, "Budget").click();
  await page.getByRole("radio", { name: "income" }).click();
  const dialog = page.getByRole("dialog", { name: "New income" });
  await expect(dialog.getByLabel("Description")).toHaveValue(salary);
  await dialog.getByLabel("Amount").fill("20000");
  await dialog.getByRole("button", { name: "Add Income" }).click();
  await expect(dialog).toBeHidden();
  await expect(noteItem(page, salary)).toContainText(`₱20,000.00 · ${salary}`);

  await noteItem(page, salary).getByRole("button", { name: new RegExp(salary) }).click();
  const editor = page.getByRole("dialog", { name: "Edit income" });
  await editor.getByLabel("Description").fill(`${salary} (Nov)`);
  await editor.getByRole("button", { name: "Update Income" }).click();
  await expect(editor).toBeHidden();
  await expect(noteItem(page, `${salary} (Nov)`)).toContainText("₱20,000.00");

  await page.goto("/dashboard/budget/incomes");
  await expect(page.getByRole("main").getByText(`${salary} (Nov)`).first()).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the capture buttons and the budget dialog fit a 390px screen", async ({ page }) => {
    const scrolls = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    for (const name of ["Reminder", "Card", "Budget"]) {
      await expect(captureButton(page, name)).toBeInViewport();
    }
    expect(await scrolls()).toBe(false);

    await captureButton(page, "Budget").click();
    const dialog = page.getByRole("dialog", { name: "New expense" });
    await expect(dialog.getByRole("radio", { name: "expense" })).toBeInViewport();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await scrolls()).toBe(false);
  });
});
