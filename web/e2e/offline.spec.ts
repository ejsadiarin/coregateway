import type { BrowserContext, Page } from "@playwright/test";

import { expect, login, newBoard, test } from "./fixtures";

// Every page shows its last-seen data offline (coregateway#92, ADR-0009):
// what each page last loaded is kept in IndexedDB per account, and with no
// connection the page shows it under an offline mark.
//
// A production build's service worker serves the app shell offline. The e2e
// web is the dev server, which has none, so goOffline stands in for it:
// page loads still reach the web, while every /api request fails the way it
// does with no connection.

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });
const offlineMark = (page: Page) => page.getByRole("status").filter({ hasText: "Last-seen data on this device" });

async function goOffline(context: BrowserContext, page: Page) {
  const web = new URL(page.url()).origin;
  await context.route(
    (url) => url.origin === web,
    async (route) => route.fulfill({ response: await route.fetch() }),
  );
  await context.setOffline(true);
}

async function goOnline(context: BrowserContext) {
  await context.setOffline(false);
  await context.unrouteAll({ behavior: "ignoreErrors" });
}

// lastSeen reads what this device keeps for the signed-in account, as text.
const lastSeen = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open("core-last-seen");
        open.onerror = () => resolve("");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("last-seen")) return resolve("");
          const all = db.transaction("last-seen").objectStore("last-seen").getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => resolve("");
        };
      }),
  );

// Offline, a read the page can't reach fails in the console by design, as
// does the dev server's reload socket. A page goOffline served (not the
// network) is refused the loopback API once back online, until it reloads.
function dropOfflineNoise(errors: string[]) {
  const expected = /ERR_INTERNET_DISCONNECTED|Failed to fetch|\[vite\] failed to connect to websocket|access the `loopback` address space/;
  for (let i = errors.length - 1; i >= 0; i--) {
    if (expected.test(errors[i])) errors.splice(i, 1);
  }
}

test("pages show their last-seen data offline, and signing out clears it", async ({
  page,
  context,
  consoleErrors,
}) => {
  await login(page);
  const note = unique("offline oat milk");
  await page.goto("/dashboard/feed");
  await page.getByRole("textbox", { name: "New note" }).fill(note);
  await page.getByRole("textbox", { name: "New note" }).press("Enter");
  await expect(noteItem(page, note)).toBeVisible();

  await expect.poll(() => lastSeen(page)).toContain(note);
  const board = await newBoard(page, "Offline board");
  const boardId = new URL(page.url()).pathname.split("/").pop();
  await expect.poll(() => lastSeen(page)).toContain(JSON.stringify(JSON.stringify(["kanban", "board", boardId])).slice(1, -1));
  await page.goto("/dashboard/kanban");
  await expect(page.getByRole("main").getByText(board, { exact: true })).toBeVisible();
  await expect.poll(() => lastSeen(page)).toContain(board);
  // A fresh load keeps what the other pages saved.
  await page.goto("/dashboard/feed");
  await expect(noteItem(page, note)).toBeVisible();
  await expect.poll(() => lastSeen(page)).toContain(board);
  await expect(offlineMark(page)).toHaveCount(0);

  await goOffline(context, page);
  await page.reload();
  await expect(noteItem(page, note)).toBeVisible();
  await expect(offlineMark(page)).toBeVisible();

  // Search covers the notes saved here, and says so.
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search the Feed" }).fill(note.split(" ").pop()!);
  await expect(page.getByText("Searching saved notes only — connect for everything")).toBeVisible();
  await expect(noteItem(page, note)).toBeVisible();
  await expect(feed(page).getByRole("listitem")).toHaveCount(1);

  await page.goto("/dashboard/kanban");
  await expect(page.getByRole("main").getByText(board, { exact: true })).toBeVisible();
  await page.getByRole("main").getByText(board, { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: board })).toBeVisible();
  await expect(offlineMark(page)).toBeVisible();

  // What only works online says so instead of loading.
  await page.goto("/dashboard/settings");
  for (const what of ["Reminder settings", "Budget settings", "Export and import"]) {
    await expect(page.getByText(`${what} needs a connection.`)).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await page.goto("/dashboard/admin/users");
  await expect(page.getByText("Users needs a connection.")).toBeVisible();

  // Back online, the page loads fresh and the mark goes.
  await goOnline(context);
  await page.goto("/dashboard/feed");
  await expect(noteItem(page, note)).toBeVisible();
  await expect(offlineMark(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Logout" }).click();
  await page.waitForURL("**/login");
  await expect.poll(() => lastSeen(page)).not.toContain(note);

  // Offline and signed out, sign-in waits for a connection.
  await goOffline(context, page);
  await page.reload();
  await expect(page.getByText("Signing in needs a connection.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Access System" })).toBeDisabled();
  await goOnline(context);
  dropOfflineNoise(consoleErrors);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the offline mark fits beside the Feed", async ({ page, context, consoleErrors }) => {
    await login(page);
    await page.goto("/dashboard/feed");
    await expect(page.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
    await expect.poll(() => lastSeen(page)).toContain("coreban");
    await goOffline(context, page);
    await page.reload();
    await expect(offlineMark(page)).toBeVisible();
    const box = await offlineMark(page).boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/offline-phone.png" });
    await goOnline(context);
    dropOfflineNoise(consoleErrors);
  });
});
