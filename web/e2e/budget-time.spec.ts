import { API_URL as api, expect, login, test } from "./fixtures";

// A budget record's time (coregateway#56, corefinance#28): set when adding,
// shown on its row and in its details, kept by an edit, and cleared on ask.

test.beforeEach(async ({ page }) => {
  await login(page);
  // The sheet reads times in the owner's saved zone and rows show them in
  // the device's; make them the same, as they are for an owner at home.
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const me = await (await page.request.get(`${api}/api/auth/me`)).json();
  const saved = await page.request.put(`${api}/api/users/${me.id}/timezone`, { data: { timezone: zone } });
  expect(saved.ok()).toBe(true);
});

test("an expense keeps the time it was given until it is cleared", async ({ page }) => {
  const description = `Timed dinner ${Date.now().toString(36)}`;
  let id: string | undefined;
  const saved = (method: string) =>
    page.waitForResponse((r) => r.url().includes("/api/budget/expenses") && r.request().method() === method);
  try {
    await page.goto("/dashboard/budget/expenses");
    await page.getByRole("button", { name: "Expense", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "New expense" });
    await sheet.getByLabel("What was it?").fill(description);
    await sheet.getByLabel("Amount").fill("75");
    await sheet.getByLabel("Time of day").fill("21:15");
    const created = saved("POST");
    await sheet.getByRole("button", { name: /^Add expense/ }).click();
    const record = await (await created).json();
    id = record.id;
    expect(record.occurred_at).not.toBeNull();
    await expect(sheet).toBeHidden();

    const row = page.getByRole("button", { name: new RegExp(description) });
    await expect(row).toContainText("21:15");
    await row.click();
    const details = page.getByRole("dialog", { name: description });
    await expect(details).toContainText("· 21:15");

    // An edit that doesn't touch the time keeps it.
    await details.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: /Edit/ });
    await expect(edit.getByText("21:15")).toBeVisible();
    await edit.getByLabel("Amount").fill("80");
    const kept = saved("PUT");
    await edit.getByRole("button", { name: "Save changes" }).click();
    expect((await (await kept).json()).occurred_at).toBe(record.occurred_at);
    await expect(row).toContainText("21:15");

    // Clearing it leaves the expense without a time.
    await row.click();
    await page.getByRole("dialog", { name: description }).getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog", { name: /Edit/ }).getByRole("button", { name: "No time" }).click();
    const cleared = saved("PUT");
    await page.getByRole("dialog", { name: /Edit/ }).getByRole("button", { name: "Save changes" }).click();
    expect((await (await cleared).json()).occurred_at).toBeNull();
    await expect(row).not.toContainText("21:15");
  } finally {
    if (id) await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});
