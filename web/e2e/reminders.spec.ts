import { API_URL as api, expect, login, test } from "./fixtures";

// The e2e stack's ntfy: coreban writes coreban-* there, and "owner" reads
// coreban-e2e (scripts/e2e-up.sh).
const NTFY = process.env.E2E_NTFY_URL ?? "http://localhost:18090";
const ownerAuth = `Basic ${Buffer.from("owner:ownerpw").toString("base64")}`;

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Settings gathers each service's settings, and old settings URLs land on their section", async ({ page }) => {
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  for (const name of ["Reminders", "Budget", "Appearance"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByLabel("Notification target")).toBeVisible();

  await page.goto("/dashboard/kanban/settings");
  await expect(page).toHaveURL(/\/dashboard\/settings#reminders$/);
});

// A one-off reminder set in the next minute shows in the bell and reaches
// the owner's ntfy topic.
test("a reminder shows in the bell and is pushed to ntfy", async ({ page }) => {
  test.setTimeout(180_000);

  // Reminders read wall times in the owner's zone; use this device's.
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const me = await (await page.request.get(`${api}/api/auth/me`)).json();
  expect((await page.request.put(`${api}/api/users/${me.id}/timezone`, { data: { timezone: zone } })).ok()).toBe(true);

  // The notification target, set where the owner sets it.
  await page.goto("/dashboard/settings#reminders");
  await page.getByLabel("Notification target").fill("e2e");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  const message = `e2e reminder ${Date.now().toString(36)}`;
  const at = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const since = Math.floor(Date.now() / 1000);
  const created = await page.request.post(`${api}/api/coreban/reminders`, {
    data: { message, schedule: { kind: "once", at: wall } },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json();

  try {
    await page.reload();
    const bell = page.getByRole("button", { name: /^Reminders/ });
    await expect(bell).toHaveAccessibleName(/in the next day/);
    await bell.click();
    await expect(page.getByRole("menuitem", { name: new RegExp(message) })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${NTFY}/coreban-e2e/json?poll=1&since=${since}`, {
            headers: { Authorization: ownerAuth },
          });
          return res.ok() ? await res.text() : `ntfy ${res.status()}`;
        },
        { timeout: 150_000, intervals: [5_000] },
      )
      .toContain(message);
  } finally {
    await page.request.delete(`${api}/api/coreban/reminders/${id}`);
  }
});

test("Reminders are added and edited in a dialog and listed by when they come", async ({ page }) => {
  const message = `e2e grouped ${Date.now().toString(36)}`;
  await page.goto("/dashboard/kanban/reminders");
  const main = page.getByRole("main");
  await expect(main.getByRole("textbox")).toHaveCount(0);

  await main.getByRole("button", { name: "New reminder" }).click();
  const dialog = page.getByRole("dialog", { name: "New reminder" });
  await dialog.getByRole("textbox", { name: "Message" }).fill(message);
  await dialog.getByLabel("When").fill("2030-03-05T07:00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  const later = main.getByRole("region", { name: /^Later/ });
  await expect(later.getByRole("listitem").filter({ hasText: message })).toContainText("Tue 5 Mar 2030, 7:00 AM");

  await main.getByRole("button", { name: `Edit reminder: ${message}` }).click();
  const editor = page.getByRole("dialog", { name: "Edit reminder" });
  await expect(editor.getByLabel("When")).toHaveValue("2030-03-05T07:00");
  await editor.getByRole("textbox", { name: "Message" }).fill(`${message} edited`);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(later.getByText(`${message} edited`, { exact: true })).toBeVisible();

  await main.getByRole("button", { name: `Delete reminder: ${message} edited` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(main.getByText(`${message} edited`, { exact: true })).toHaveCount(0);
});

test("the Calendar marks each day a reminder is sent and adds one on a chosen day", async ({ page }) => {
  const message = `e2e weekly ${Date.now().toString(36)}`;
  const created = await page.request.post(`${api}/api/coreban/reminders`, {
    data: { message, schedule: { kind: "weekly", time: "08:00", weekdays: ["MO"] } },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json();

  try {
    await page.goto("/dashboard/kanban/reminders");
    const main = page.getByRole("main");
    // A desktop shows the list and the calendar side by side, no toggle.
    await expect(main.getByRole("group", { name: "View" })).toHaveCount(0);
    await expect(main.getByRole("region", { name: /^This week|^Later|^Tomorrow|^Today/ }).first()).toBeVisible();

    // Next month: every Monday, and only Mondays, carry it.
    await main.getByRole("button", { name: "Next month" }).click();
    const days = main.getByRole("group", { name: /^Days of / });
    const marked = await days.getByRole("button", { name: /1 reminder$/ }).evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")?.slice(0, 3)),
    );
    expect(marked.length).toBeGreaterThanOrEqual(4);
    expect(new Set(marked)).toEqual(new Set(["Mon"]));

    await days.getByRole("button", { name: /1 reminder$/ }).first().click();
    const day = main.getByRole("region", { name: /^Mon / });
    await expect(day.getByRole("listitem").filter({ hasText: message })).toContainText("8:00 AM");

    // A day with nothing on it offers to add one there.
    const tuesday = days.getByRole("button", { name: /^Tue / }).nth(1);
    const label = (await tuesday.getAttribute("aria-label"))!;
    await tuesday.click();
    await expect(main.getByRole("region", { name: label })).toContainText("Nothing to send this day.");
    await main.getByRole("button", { name: `Add a reminder on ${label}` }).click();
    const dialog = page.getByRole("dialog", { name: "New reminder" });
    await expect(dialog.getByLabel("When")).toHaveValue(/T09:00$/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  } finally {
    await page.request.delete(`${api}/api/coreban/reminders/${id}`);
  }
});

test("below desktop width, the List and Calendar toggle switches views and is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const message = `e2e toggle ${Date.now().toString(36)}`;
  const created = await page.request.post(`${api}/api/coreban/reminders`, {
    data: { message, schedule: { kind: "daily", time: "08:00" } },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json();

  try {
    await page.goto("/dashboard/kanban/reminders");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Calendar" }).click();
    await expect(main.getByRole("group", { name: /^Days of / })).toBeVisible();
    await page.reload();
    await expect(main.getByRole("button", { name: "Calendar" })).toHaveAttribute("aria-pressed", "true");
    await main.getByRole("button", { name: "List" }).click();
    await expect(main.getByRole("group", { name: /^Days of / })).toHaveCount(0);
  } finally {
    await page.request.delete(`${api}/api/coreban/reminders/${id}`);
    await page.evaluate(() => localStorage.removeItem("core-reminders-view"));
  }
});
