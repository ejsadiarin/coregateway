import type { Page } from "@playwright/test";

import { API_URL as api, expect, login, test } from "./fixtures";

// Searching the Feed (coreban#18): one list of notes, reminders and budget
// records, in Feed order.

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const items = (page: Page) => feed(page).getByRole("listitem");
const box = (page: Page) => page.getByRole("searchbox", { name: "Search the Feed" });

async function search(page: Page, q: string) {
  if (!(await box(page).isVisible())) await page.getByRole("button", { name: "Search", exact: true }).click();
  await box(page).fill(q);
}

async function post(page: Page, text: string) {
  await page.getByRole("textbox", { name: "New note" }).fill(text);
  await page.getByRole("textbox", { name: "New note" }).press("Enter");
  await expect(items(page).filter({ hasText: text })).toBeVisible();
}

// seed makes a plain note, a reminder and an expense that share tag, and one
// note that doesn't, then opens the Feed, whose sync gives the expense its note.
async function seed(page: Page, tag: string) {
  const ok = async (path: string, data: unknown) => {
    const res = await page.request.post(`${api}${path}`, { data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
  };
  await ok("/api/coreban/notes", { text: `plain ${tag}` });
  await ok("/api/coreban/notes", { text: unique("unrelated") });
  await ok("/api/coreban/reminders", {
    message: `call ${tag}`,
    schedule: { kind: "once", at: "2030-03-05T07:00" },
    note: "new",
  });
  // Yesterday's, so it sits before the notes whatever the second.
  const now = new Date(Date.now() - 24 * 3600 * 1000);
  const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  await ok("/api/budget/expenses", {
    description: `Ramen ${tag}`,
    amount: 1250,
    currency: "PHP",
    expense_date: day,
    priority: "want",
    status: "posted",
    recurring_type: "one-time",
    is_debt: false,
  });
  await page.reload();
  await expect(items(page).filter({ hasText: `Ramen ${tag}` })).toBeVisible();
}

// The stack's coreban allows few reminders (REMINDER_CAP), so each is
// deleted again.
test.afterEach(async ({ page }) => {
  const res = await page.request.get(`${api}/api/coreban/reminders`);
  const all: { id: string; message: string }[] = await res.json();
  for (const r of all.filter((x) => x.message.startsWith("call findme"))) {
    await page.request.delete(`${api}/api/coreban/reminders/${r.id}`);
  }
});

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/feed");
  await expect(page.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
});

test("one search finds a plain note, a reminder and an expense, and the filters apply", async ({ page }) => {
  const tag = unique("findme");
  await seed(page, tag);

  await search(page, tag.toUpperCase());
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).nth(0)).toContainText(`Ramen ${tag}`);
  await expect(items(page).nth(1)).toContainText(`plain ${tag}`);
  await expect(items(page).nth(2)).toContainText(`call ${tag}`);
  await expect(page.getByRole("textbox", { name: "New note" })).toBeHidden();

  // Every word must match, and an expense's amount is one of them.
  await search(page, `1,250 ${tag}`);
  await expect(items(page)).toHaveCount(1);
  await expect(items(page)).toContainText(`Ramen ${tag}`);

  await search(page, tag);
  await expect(items(page)).toHaveCount(3);
  const show = page.getByRole("group", { name: "Show" });
  await show.getByRole("button", { name: "Budget" }).click();
  await expect(items(page)).toHaveCount(1);
  await show.getByRole("button", { name: "Notes" }).click();
  await expect(items(page)).toHaveCount(2);
  await show.getByRole("button", { name: "All" }).click();
  await expect(items(page)).toHaveCount(3);

  // Escape returns to the whole Feed at its newest note, focus on Search.
  await box(page).press("Escape");
  await expect(box(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  await expect(items(page).last()).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "New note" })).toBeVisible();
});

test("a search that finds nothing says so", async ({ page }) => {
  await post(page, unique("something"));
  const q = unique("nowhere");
  await search(page, q);
  await expect(feed(page)).toContainText(`No notes match “${q}”.`);
});

test("a note edited or archived in the results is changed in the Feed too", async ({ page }) => {
  const tag = unique("findme");
  await post(page, `keep ${tag}`);
  await post(page, `drop ${tag}`);
  await search(page, tag);
  await expect(items(page)).toHaveCount(2);

  const act = async (text: string, action: string) => {
    await items(page).filter({ hasText: text }).getByRole("button", { name: "Note actions" }).click();
    await page.getByRole("menuitem", { name: action }).click();
  };
  await act(`drop ${tag}`, "Archive");
  await expect(items(page)).toHaveCount(1);
  await act(`keep ${tag}`, "Edit text");
  await page.getByRole("textbox", { name: "Note text" }).fill(`kept ${tag}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(items(page)).toContainText(`kept ${tag}`);

  const archived = page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Archived" });
  await archived.click();
  await expect(items(page)).toHaveCount(2);
  await archived.click();

  await page.getByRole("button", { name: "Close search" }).click();
  await expect(items(page).filter({ hasText: `kept ${tag}` })).toBeVisible();
  await expect(items(page).filter({ hasText: `drop ${tag}` })).toHaveCount(0);
});

test("a draft waits while the search is open", async ({ page }) => {
  const draft = unique("half a thought");
  await page.getByRole("textbox", { name: "New note" }).fill(draft);
  await search(page, unique("nowhere"));
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue(draft);
});

test("if the budget can't be read, the rest is still found", async ({ page }) => {
  const tag = unique("findme");
  await post(page, `plain ${tag}`);
  await page.route("**/api/budget/incomes?*", (r) => r.fulfill({ status: 500, body: "{}" }));
  await page.reload();
  await search(page, tag);
  // React Query retries before it gives up.
  await expect(page.getByText("expenses and incomes aren't included")).toBeVisible({ timeout: 20_000 });
  await expect(items(page)).toHaveCount(1);
});

test("a failed search offers Retry", async ({ page }) => {
  const tag = unique("findme");
  await post(page, `plain ${tag}`);
  let broken = true;
  await page.route("**/api/coreban/notes/search", (r) => (broken ? r.fulfill({ status: 500, body: "{}" }) : r.continue()));
  await search(page, tag);
  await expect(feed(page)).toContainText("Couldn't search the Feed.", { timeout: 20_000 });
  broken = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(items(page)).toHaveCount(1);
});

test("at 390px the search fits without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tag = unique("findme");
  await seed(page, tag);
  await search(page, tag);
  await expect(items(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: process.env.SEARCH_SHOT || test.info().outputPath("search-390.png") });
});
