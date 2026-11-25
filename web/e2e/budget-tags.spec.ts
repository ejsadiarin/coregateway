import { API_URL as api, expect, login, test } from "./fixtures";

// The record sheet shows the owner's tags as chips to tap, no "+" first:
// a tap picks one, another tap drops it, and "New tag" makes one that
// doesn't exist yet.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("existing tags show in the sheet and a tap picks them", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const trip = `trip${suffix}`;
  const tag = await page.request.post(`${api}/api/budget/tags`, { data: { name: trip } });
  expect(tag.ok(), await tag.text()).toBe(true);
  const tagId = (await tag.json()).id;
  const description = `Tagged lunch ${suffix}`;
  let id: string | undefined;
  try {
    await page.goto("/dashboard/budget/expenses");
    await page.getByRole("button", { name: "Expense", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "New expense" });

    const chip = sheet.getByRole("button", { name: `#${trip}`, exact: true });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();

    // A tag that doesn't exist yet is made from "New tag".
    const fresh = `fresh${suffix}`;
    await sheet.getByRole("button", { name: "New tag" }).click();
    await sheet.getByRole("textbox", { name: "New tag" }).fill(fresh);
    await sheet.getByRole("textbox", { name: "New tag" }).press("Enter");
    await expect(sheet.getByRole("button", { name: `#${fresh}`, exact: true })).toHaveAttribute("aria-pressed", "true");

    await sheet.getByLabel("What was it?").fill(description);
    await sheet.getByLabel("Amount").fill("90");
    const created = page.waitForResponse((r) => r.url().endsWith("/api/budget/expenses") && r.request().method() === "POST");
    await sheet.getByRole("button", { name: /^Add expense/ }).click();
    id = (await (await created).json()).id;
    await expect(sheet).toBeHidden();

    // Both stay picked when the expense is opened to edit.
    await page.getByRole("button", { name: new RegExp(description) }).click();
    await page.getByRole("dialog", { name: description }).getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: /Edit/ });
    await expect(edit.getByRole("button", { name: `#${trip}`, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(edit.getByRole("button", { name: `#${fresh}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    if (id) await page.request.delete(`${api}/api/budget/expenses/${id}`);
    await page.request.delete(`${api}/api/budget/tags/${tagId}`);
  }
});
