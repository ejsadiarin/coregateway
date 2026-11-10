import type { Locator } from "@playwright/test";

import { addCard, column, columnAction, deleteBoard, drag, expect, login, newBoard, test } from "./fixtures";

// Card titles in a column, top to bottom.
const titles = (col: Locator) =>
  col.getByRole("listitem").evaluateAll((items) => items.map((li) => li.querySelector("span")?.textContent ?? ""));

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("a new board starts with one column per status", async ({ page }) => {
  const name = await newBoard(page, "Defaults");
  const regions = await page.getByRole("region").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")).filter(Boolean),
  );
  expect(regions).toEqual(["Todo (Todo)", "Doing (In progress)", "Done (Done)"]);
  await deleteBoard(page, name);
});

test("editing a card saves its title, description, and due", async ({ page }) => {
  // Every save here is a PATCH through the gateway: this is the path that
  // broke when CORS didn't allow PATCH.
  const name = await newBoard(page, "Edit");
  await addCard(page, "Renew TLS cert");

  await page.getByRole("main").getByText("Renew TLS cert", { exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit card" });
  await editor.getByRole("textbox", { name: "Title" }).fill("Renew TLS cert for gateway");
  await editor.getByRole("textbox", { name: "Description" }).fill("check expiry: `openssl x509 -enddate -noout`");
  await editor.getByRole("combobox", { name: "Due" }).click();
  await page.getByRole("option", { name: "Date and time" }).click();
  await editor.getByLabel("Day and time, in your Kanban timezone").fill("2026-12-01T09:30");
  await editor.getByRole("tab", { name: "Preview" }).click();
  await expect(editor.getByRole("tabpanel").locator("code")).toHaveText("openssl x509 -enddate -noout");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();

  await page.reload();
  const todo = column(page, "Todo", "Todo");
  await expect(todo.getByText("Renew TLS cert for gateway", { exact: true })).toBeVisible();
  await expect(todo).toContainText(/Due Tue 1 Dec, \d\d:30/i);

  // Clearing the due drops it from the card.
  await page.getByRole("main").getByText("Renew TLS cert for gateway", { exact: true }).click();
  await editor.getByRole("combobox", { name: "Due" }).click();
  await page.getByRole("option", { name: "No due" }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(todo).not.toContainText("Due");

  await deleteBoard(page, name);
});

test("dragging moves a card across columns and reorders within one", async ({ page }) => {
  const name = await newBoard(page, "Drag");
  for (const t of ["First", "Second", "Third"]) await addCard(page, t);
  const todo = column(page, "Todo", "Todo");
  const done = column(page, "Done", "Done");
  const card = (t: string) => page.getByRole("main").getByText(t, { exact: true });

  // Across: First -> Done, so its status becomes Done.
  const doneBox = (await done.boundingBox())!;
  await drag(page, card("First"), { x: doneBox.x + doneBox.width / 2, y: doneBox.y + 120 });
  await expect.poll(() => titles(done)).toEqual(["First"]);

  // Within: Third above Second.
  const second = (await card("Second").boundingBox())!;
  await drag(page, card("Third"), { x: second.x + 20, y: second.y - 6 });
  await expect.poll(() => titles(todo)).toEqual(["Third", "Second"]);

  // Both moves were saved, not just drawn.
  await page.reload();
  await expect.poll(() => titles(todo)).toEqual(["Third", "Second"]);
  await expect.poll(() => titles(done)).toEqual(["First"]);
  await page.getByRole("main").getByText("First", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit card" })).toContainText("Status: Done, from its column.");
  await page.keyboard.press("Escape");

  await deleteBoard(page, name);
});

test("column guards keep one column per status and never drop cards", async ({ page }) => {
  const name = await newBoard(page, "Guards");
  const main = page.getByRole("main");

  // The only Todo column can't change status.
  await columnAction(page, "Todo", "Edit column");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toContainText("Todo is the board's only Todo column");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The only In progress column can't be deleted.
  await columnAction(page, "Doing", "Delete column");
  await expect(column(page, "Doing", "In progress")).toBeVisible();

  // A column holding a card can't be deleted.
  await page.getByRole("combobox", { name: "Column for the new card" }).click();
  await page.getByRole("option", { name: "Done · Done" }).click();
  await addCard(page, "Shipped already");
  await columnAction(page, "Done", "Delete column");
  await expect(main).toContainText("Done still holds cards");
  await expect(column(page, "Done", "Done").getByText("Shipped already")).toBeVisible();

  // An empty, redundant column can be added, renamed, moved, and deleted.
  await page.getByRole("button", { name: "Add column" }).click();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Review");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(column(page, "Review", "In progress")).toBeVisible();
  await columnAction(page, "Review", "Move left");
  await expect
    .poll(() => page.getByRole("region").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).filter(Boolean)))
    .toEqual(["Todo (Todo)", "Doing (In progress)", "Review (In progress)", "Done (Done)"]);
  await columnAction(page, "Review", "Delete column");
  await expect(column(page, "Review", "In progress")).toHaveCount(0);

  await deleteBoard(page, name);
});

test("a board is private to its owner", async ({ page, browser }) => {
  const name = await newBoard(page, "Private");
  const boardUrl = page.url();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto("/login");
  await guest.getByRole("button", { name: "Try Demo Mode (Guest Access)" }).click();
  await guest.waitForURL("**/dashboard");
  await guest.goto("/dashboard/kanban");
  await expect(guest.getByRole("main")).not.toContainText(name);
  await guest.goto(boardUrl);
  await expect(guest.getByRole("main")).toContainText("Board not found");
  await guest.context().close();

  await deleteBoard(page, name);
});
