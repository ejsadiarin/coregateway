import { API_URL as api, expect, login, test } from "./fixtures";

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

async function budgetValues(page: import("@playwright/test").Page) {
  const date = today();
  const money = await page.request.get(`${api}/api/budget/current-total-money`);
  const budget = await page.request.get(`${api}/api/budget/period-budget?period=day&date=${date}`);
  expect(money.ok()).toBe(true);
  expect(budget.ok()).toBe(true);
  return {
    date,
    money: (await money.json()) as { total_money: number },
    budget: (await budget.json()) as { safe_to_spend_per_day: number | null; left: number },
  };
}

test("admin home shows the summary and the service health line", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");

  await expect(page.getByText("Latest notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Due today", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick capture", { exact: true })).toBeVisible();
  await expect(page.getByText(/services up/)).toBeVisible();
  await expect(page.getByText("SYSTEM VITALS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("QUICK ACTIONS", { exact: true })).toHaveCount(0);
});

test("guest home is the personal summary and never calls the admin service endpoints", async ({ page }) => {
  const serviceCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/services")) serviceCalls.push(request.url());
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Try Demo Mode (Guest Access)" }).click();
  await page.waitForURL("**/dashboard");
  const values = await budgetValues(page);
  await page.goto("/dashboard");
  await expect(page.getByText("HOME", { exact: true })).toBeVisible();
  await expect(page.getByText("Latest notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Due today", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick capture", { exact: true })).toBeVisible();
  const budgetCard = page.getByTestId("budget-glance-card");
  await expect(budgetCard).toContainText(peso(Number(values.money.total_money)));
  const safe = values.budget.safe_to_spend_per_day ?? values.budget.left;
  await expect(budgetCard).toContainText(peso(Number(safe)));
  await expect(page.getByText(/services up/)).toHaveCount(0);
  expect(serviceCalls).toEqual([]);
});

test("budget today matches corefinance and opens the budget page", async ({ page }) => {
  await login(page);
  const values = await budgetValues(page);
  await page.goto("/dashboard");

  const card = page.getByTestId("budget-glance-card");
  await expect(card).toContainText(peso(Number(values.money.total_money)));
  const safe = values.budget.safe_to_spend_per_day ?? values.budget.left;
  await expect(card).toContainText(peso(Number(safe)));

  await card.click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/budget\\?period=day&date=${values.date.replaceAll("-", "\\-")}`),
  );
});

test("negative left is flagged on the home budget card", async ({ page }) => {
  await login(page);
  const expense = await page.request.post(`${api}/api/budget/expenses`, {
    data: {
      amount: 5000000,
      currency: "PHP",
      description: `home over budget ${Date.now()}`,
      expense_date: today(),
      priority: "want",
      status: "posted",
      is_debt: false,
    },
  });
  expect(expense.ok()).toBe(true);
  const expenseId = ((await expense.json()) as { id: string }).id;

  try {
    await page.goto("/dashboard");
    const card = page.getByTestId("budget-glance-card");
    await expect(card).toContainText("Over budget");
    await expect(card.locator(".text-destructive").first()).toBeVisible();
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${expenseId}`);
  }
});

test("a corefinance outage only breaks the budget section", async ({ page }) => {
  await login(page);
  await page.route("**/api/budget/current-total-money", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/budget/period-budget*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/dashboard");

  await expect(page.getByTestId("budget-glance-card")).toContainText("Budget unavailable");
  await expect(page.getByText("Latest notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Due today", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick capture", { exact: true })).toBeVisible();
});

test("home shows the latest note and a reminder due today", async ({ page }) => {
  await login(page);
  const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
  const noteText = unique("Home note");
  const reminderMessage = unique("Home reminder");
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  const note = await page.request.post(`${api}/api/coreban/notes`, { data: { text: noteText } });
  expect(note.ok()).toBe(true);
  const noteId = ((await note.json()) as { id: string }).id;
  const reminder = await page.request.post(`${api}/api/coreban/reminders`, {
    data: { message: reminderMessage, schedule: { kind: "once", at: `${date}T23:59:00` } },
  });
  expect(reminder.ok()).toBe(true);
  const reminderId = ((await reminder.json()) as { id: string }).id;

  try {
    await page.goto("/dashboard");
    await expect(page.getByText(noteText)).toBeVisible();
    await expect(page.getByText(reminderMessage)).toBeVisible();
  } finally {
    await page.request.delete(`${api}/api/coreban/notes/${noteId}`);
    await page.request.delete(`${api}/api/coreban/reminders/${reminderId}`);
  }
});

test("home fits a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/dashboard");
  await expect(page.getByText("Latest notes", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick capture", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("one failing downstream leaves the other sections standing", async ({ page }) => {
  await login(page);
  await page.route("**/api/coreban/notes*", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/dashboard");

  await expect(page.getByText("Couldn't load your notes.")).toBeVisible();
  await expect(page.getByText("Due today", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick capture", { exact: true })).toBeVisible();
});

test("the old mock endpoints are gone", async ({ page }) => {
  await login(page);
  for (const path of ["system/stats", "legacy/services"]) {
    const res = await page.request.get(`${api}/api/${path}`);
    expect(res.status()).toBe(404);
  }
});
