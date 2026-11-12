import { test as base, expect, type Locator, type Page } from "@playwright/test";

// Matches scripts/e2e-up.sh, which seeds this admin into a throwaway database.
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@e2e.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-pass-123",
};

// Fails a test on any console error except the browser's own line for a
// non-2xx response ("Failed to load resource: … 401/409"): those are expected
// when the app checks /me or a guard refuses. A CORS block or a React
// warning (duplicate keys, invalid hooks) is a real bug and fails here.
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// The gateway the web calls, for requests a test makes "elsewhere" with the
// page's own session. scripts/e2e-up.sh serves it on :18080 beside the web.
export const API_URL =
  process.env.E2E_API_URL ?? (process.env.E2E_BASE_URL ?? "http://localhost:3001").replace(/:3001$/, ":18080");

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Access System" }).click();
  await page.waitForURL("**/dashboard");
}

// newBoard creates a uniquely named board and opens it, so tests never
// collide with each other or with a previous run on the same stack.
export async function newBoard(page: Page, prefix: string): Promise<string> {
  const name = `${prefix} ${Date.now().toString(36)}`;
  await page.goto("/dashboard/kanban");
  await page.getByLabel("New board").fill(name);
  await page.getByRole("main").getByRole("button", { name: "Create" }).click();
  await page.getByRole("main").getByText(name, { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

export async function deleteBoard(page: Page, name: string) {
  await page.goto("/dashboard/kanban");
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("main").getByText(name, { exact: true })).toHaveCount(0);
}

export const column = (page: Page, name: string, status: string) =>
  page.getByRole("region", { name: `${name} (${status})` });

export async function addCard(page: Page, title: string) {
  await page.getByRole("textbox", { name: "New card" }).fill(title);
  await page.getByRole("main").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("main").getByText(title, { exact: true })).toBeVisible();
}

export async function columnAction(page: Page, columnName: string, item: string) {
  await page.getByRole("button", { name: `${columnName} column actions` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

// drag moves a card with real pointer events: dnd-kit only starts a drag
// after the pointer travels past its activation distance, so a single jump
// (locator.dragTo) is not enough.
export async function drag(page: Page, card: Locator, to: { x: number; y: number }) {
  const from = await card.boundingBox();
  if (!from) throw new Error("card is not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 25 });
  await page.mouse.up();
}
