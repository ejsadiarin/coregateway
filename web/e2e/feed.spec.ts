import type { Page } from "@playwright/test";

import { expect, login, test } from "./fixtures";

// unique keeps notes from colliding with another test or an earlier run on
// the same stack.
const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });

async function post(page: Page, text: string) {
  await page.getByRole("textbox", { name: "New note" }).fill(text);
  await page.getByRole("textbox", { name: "New note" }).press("Enter");
  await expect(noteItem(page, text)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
}

async function noteAction(page: Page, text: string, action: string) {
  await noteItem(page, text).getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/feed");
  await expect(page.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
});

test("a posted note shows newest last, with its link tappable, and survives a reload", async ({ page }) => {
  const text = unique("read later");
  await post(page, `${text} https://example.com/article.`);

  const link = noteItem(page, text).getByRole("link", { name: "https://example.com/article" });
  await expect(link).toHaveAttribute("href", "https://example.com/article");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.reload();
  await expect(feed(page).getByRole("listitem").last()).toContainText(text);
  await noteAction(page, text, "Permanently delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(noteItem(page, text)).toHaveCount(0);
});

test("editing a note's text saves it", async ({ page }) => {
  const text = unique("buy milk");
  await post(page, text);
  await noteAction(page, text, "Edit text");
  const edited = `${text} and eggs`;
  await page.getByRole("textbox", { name: "Note text" }).fill(edited);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(noteItem(page, edited)).toBeVisible();

  await page.reload();
  await expect(noteItem(page, edited)).toBeVisible();
});

test("an archived note stays in place, collapsed, and can be restored or erased", async ({ page }) => {
  const text = unique("old thought");
  const after = unique("newer thought");
  await post(page, text);
  await post(page, after);

  await noteAction(page, text, "Archive");
  const archived = noteItem(page, text);
  const toggle = archived.getByRole("button", { name: /Archived/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Still before the newer note after a reload.
  await page.reload();
  const items = await feed(page).getByRole("listitem").allTextContents();
  const at = items.findIndex((t) => t.includes(text));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(items[at]).toContain("Archived");
  expect(items[at + 1]).toContain(after);

  await toggle.click();
  await archived.getByRole("button", { name: "Restore" }).click();
  await expect(noteItem(page, text).getByRole("button", { name: "Note actions" })).toBeVisible();

  await noteAction(page, text, "Archive");
  await noteItem(page, text).getByRole("button", { name: /Archived/ }).click();
  await noteItem(page, text).getByRole("button", { name: "Permanently delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(noteItem(page, text)).toHaveCount(0);
  await page.reload();
  await expect(noteItem(page, after)).toBeVisible();
  await expect(noteItem(page, text)).toHaveCount(0);
});

test("a blank note can't be sent", async ({ page }) => {
  await page.getByRole("textbox", { name: "New note" }).fill("   ");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});
