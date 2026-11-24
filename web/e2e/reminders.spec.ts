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
