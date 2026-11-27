import type { Page } from "@playwright/test";

import { API_URL as api, expect, login, test } from "./fixtures";

// Expense and income notes: the record lives in corefinance, the note in
// coreban (coreban#16). Changes made "elsewhere" go straight to
// corefinance's API with the page's own session, as the Expenses page does.

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });
// The capture buttons above the chat box, not the "Budget" filter.
const captureButton = (page: Page, name: string) =>
  page.locator("form", { has: page.getByRole("textbox", { name: "New note" }) }).getByRole("button", { name, exact: true });

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
  await expect(dialog.getByLabel("What was it?")).toHaveValue(description);
  await dialog.getByLabel("Amount").fill(amount);
  const created = page.waitForResponse((r) => r.url().endsWith("/api/budget/expenses") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Add expense/ }).click();
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

// coregateway#60: the note of a record just saved from the sheet flashes
// where it landed, then settles.
test("a record saved from + Budget flashes where its note lands", async ({ page }) => {
  const taxi = unique("Taxi");
  const id = await captureExpense(page, taxi, "180");
  try {
    await expect(noteItem(page, taxi)).toHaveClass(/feed-landed/);
    await expect(noteItem(page, taxi)).toBeInViewport();
    await expect(noteItem(page, taxi)).not.toHaveClass(/feed-landed/, { timeout: 4000 });
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});

test("+ Budget captures an expense shown live; editing or deleting it elsewhere shows in its note", async ({ page }) => {
  const lunch = unique("Lunch");
  const id = await captureExpense(page, lunch, "250");
  await expect(noteItem(page, lunch)).toContainText("−₱250.00");

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

test("deleting an expense from its note names it, then leaves a deleted line that can be archived", async ({ page }) => {
  const taxi = unique("Taxi");
  const id = await captureExpense(page, taxi, "180");

  await noteAction(page, taxi, "Delete expense");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`Delete the expense “${taxi}” (₱180.00)`);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(noteItem(page, taxi)).toContainText(`₱180.00 · ${taxi} (deleted)`);
  expect(await expenseStatus(page, id)).toBe(404);

  await page.reload();
  await expect(noteItem(page, taxi)).toContainText(`₱180.00 · ${taxi} (deleted)`);
  await noteAction(page, taxi, "Archive");
  await expect(noteItem(page, taxi)).toHaveCount(0);
});

test("a live expense's note can't be erased; a deleted one's can, for good", async ({ page }) => {
  const snack = unique("Snack");
  // A second expense stays, so the Feed's sync has something to send.
  await captureExpense(page, unique("Bus"), "15");
  const id = await captureExpense(page, snack, "60");
  const actions = noteItem(page, snack).getByRole("button", { name: "Note actions" });

  // The sync would bring a live record's note back (coreban ADR-0005).
  await actions.click();
  await expect(page.getByRole("menuitem", { name: "Delete expense" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Permanently delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  expect((await page.request.delete(`${api}/api/budget/expenses/${id}`)).ok()).toBe(true);
  await page.reload();
  await expect(noteItem(page, snack)).toContainText("(deleted)");
  await noteAction(page, snack, "Permanently delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(noteItem(page, snack)).toHaveCount(0);

  const synced = page.waitForResponse((r) => r.url().endsWith("/api/coreban/notes/sync"));
  await page.reload();
  await synced;
  await expect(feed(page)).toHaveAttribute("aria-busy", "false");
  await expect(noteItem(page, snack)).toHaveCount(0);
});

test("going offline between the two delete steps leaves the expense gone and the note deleted", async ({ page }) => {
  const coffee = unique("Coffee");
  const id = await captureExpense(page, coffee, "95");

  // The expense is deleted; saving its snapshot never reaches coreban.
  await page.route("**/api/coreban/notes/*", (route) =>
    route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue(),
  );
  await noteAction(page, coffee, "Delete expense");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Failed to fetch")).toBeVisible();
  expect(await expenseStatus(page, id)).toBe(404);

  await page.unrouteAll();
  await page.reload();
  await expect(noteItem(page, coffee)).toContainText(`₱95.00 · ${coffee} (deleted)`);
});

test("+ Budget switches to income, and tapping its note edits it in corefinance", async ({ page }) => {
  const salary = unique("Salary");
  await page.getByRole("textbox", { name: "New note" }).fill(salary);
  await captureButton(page, "Budget").click();
  await page.getByRole("radio", { name: "income" }).click();
  const dialog = page.getByRole("dialog", { name: "New income" });
  await expect(dialog.getByLabel("Where from?")).toHaveValue(salary);
  await dialog.getByLabel("Amount").fill("20000");
  await dialog.getByRole("button", { name: /^Add income/ }).click();
  await expect(dialog).toBeHidden();
  await expect(noteItem(page, salary)).toContainText("+₱20,000.00");

  await noteItem(page, salary).getByRole("button", { name: new RegExp(salary) }).click();
  const editor = page.getByRole("dialog", { name: "Edit income" });
  await editor.getByLabel("Where from?").fill(`${salary} (Nov)`);
  await editor.getByRole("button", { name: "Save changes" }).click();
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

// coregateway#77: a reply to an expense's note quotes the expense as
// corefinance has it now.
test("a reply to an expense's note quotes the expense, live", async ({ page }) => {
  const lunch = unique("Lunch");
  const id = await captureExpense(page, lunch, "250");
  try {
    await noteItem(page, lunch).first().getByRole("button", { name: "Note actions" }).click();
    await page.getByRole("menuitem", { name: "Reply" }).click();
    await expect(page.getByRole("region", { name: "Replying to" })).toContainText(lunch);
    const why = unique("why so much");
    await page.getByRole("textbox", { name: "New note" }).fill(why);
    await page.getByRole("textbox", { name: "New note" }).press("Enter");
    const quote = noteItem(page, why).getByRole("figure", { name: "Replying to" });
    await expect(quote).toContainText(lunch);
    await expect(quote).toContainText("250");

    // Changed elsewhere: the quote follows the expense after a reload.
    const current = await (await page.request.get(`${api}/api/budget/expenses/${id}`)).json();
    const res = await page.request.put(`${api}/api/budget/expenses/${id}`, { data: { ...current, amount: 320 } });
    expect(res.ok()).toBe(true);
    await page.reload();
    await expect(noteItem(page, why).getByRole("figure", { name: "Replying to" })).toContainText("320");
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});
