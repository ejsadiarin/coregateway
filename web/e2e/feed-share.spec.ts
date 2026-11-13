import type { Page } from "@playwright/test";

import { ADMIN, API_URL, expect, login, test } from "./fixtures";

// Sharing text from another app (coreban#17). The service worker turns
// the share sheet's POST into a GET to /share with the shared title, text
// and url (feed-share-files.spec.ts), so these tests open that URL. Only
// the share sheet listing the installed app is left to a check on a real
// phone.

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });

const shareUrl = (shared: Record<string, string>) => `/share?${new URLSearchParams(shared)}`;

test("a page shared from Chrome lands in the Feed as one plain note, in view", async ({ page }) => {
  await login(page);
  // Other notes posted before it, so the Feed has more than the share.
  for (let i = 0; i < 3; i++) {
    await page.request.post(`${API_URL}/api/coreban/notes`, {
      data: { text: unique("filler") },
    });
  }
  const title = unique("Gateway API guide");
  const link = `https://example.com/${title.split(" ").at(-1)}`;

  // Chrome shares a page as its title, with the URL in text.
  await page.goto(shareUrl({ title, text: link }));
  await page.waitForURL("**/dashboard/feed");
  const note = noteItem(page, title);
  await expect(note).toBeInViewport();
  await expect(note.getByRole("link", { name: link })).toHaveAttribute("href", link);

  // Going back doesn't share it twice.
  await page.goBack();
  await page.goto("/dashboard/feed");
  await expect(noteItem(page, title)).toHaveCount(1);
});

test("a share that arrives signed out is posted once you sign in", async ({ page }) => {
  const text = unique("buy rice");
  await page.goto(shareUrl({ text }));
  await page.waitForURL("**/login");

  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Access System" }).click();
  await page.waitForURL("**/dashboard/feed");
  await expect(noteItem(page, text)).toBeInViewport();
  await page.goBack();
  expect(new URL(page.url()).pathname).not.toBe("/login");
});

test("a share that can't be posted keeps its text on screen to retry", async ({ page }) => {
  await login(page);
  const text = unique("offline share");
  let refuse = true;
  await page.route("**/api/coreban/notes", (route) =>
    refuse && route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );

  await page.goto(shareUrl({ text }));
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("Couldn't share this to the Feed");
  await expect(main.getByText(text)).toBeVisible();

  refuse = false;
  await main.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForURL("**/dashboard/feed");
  await expect(noteItem(page, text)).toBeInViewport();
});

test("a share refused for an expired session goes through login, then posts", async ({ page }) => {
  await login(page);
  const text = unique("expired share");
  let expired = true;
  await page.route("**/api/coreban/notes", (route) => {
    if (!expired || route.request().method() !== "POST") return route.continue();
    expired = false;
    return route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });

  await page.goto(shareUrl({ text }));
  await page.waitForURL("**/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Access System" }).click();
  await page.waitForURL("**/dashboard/feed");
  await expect(noteItem(page, text)).toBeInViewport();

  // Back from the Feed doesn't land on the login form again.
  await page.goBack();
  expect(new URL(page.url()).pathname).not.toBe("/login");
});

test("an empty share says so and offers the Feed", async ({ page }) => {
  await login(page);
  await page.goto(shareUrl({ title: " ", text: "" }));
  const main = page.getByRole("main");
  await expect(main).toContainText("Nothing was shared");
  await main.getByRole("link", { name: "Open the Feed" }).click();
  await page.waitForURL("**/dashboard/feed");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a share waiting to retry fits a 390px screen, long link and all", async ({ page }) => {
    await login(page);
    await page.route("**/api/coreban/notes", (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
    );
    await page.goto(shareUrl({ title: unique("Long read"), url: `https://example.com/${"a".repeat(300)}` }));
    const main = page.getByRole("main");
    await expect(main.getByRole("alert")).toBeVisible();
    await expect(main.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});
