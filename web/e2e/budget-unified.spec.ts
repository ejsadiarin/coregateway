import { API_URL as api, expect, login, test } from "./fixtures";

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return ymd(date);
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const periodCard = (page: import("@playwright/test").Page) =>
  page.getByText("Period budget", { exact: true }).locator("..").locator("..");

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("headline shows money on hand, committed and runway", async ({ page }) => {
  const res = await page.request.get(`${api}/api/budget/current-total-money`);
  expect(res.ok()).toBe(true);
  const money = (await res.json()) as {
    total_money: number;
    committed: number;
    average_daily_spend: number;
    runway_days: number | null;
  };

  await page.goto(`/dashboard/budget?period=day&date=${today()}`);
  const card = page.getByText("Money on hand", { exact: true }).locator("..").locator("..");
  await expect(card).toContainText(peso(Number(money.total_money)));
  await expect(card).toContainText(peso(Number(money.committed)));
  if (money.runway_days === null) {
    await expect(card).toContainText("No spending in the last 30 days");
  } else {
    await expect(card).toContainText(`${money.runway_days} days`);
  }
});

test("period budget matches the read and the selector survives a reload", async ({ page }) => {
  const date = today();
  const created: string[] = [];
  try {
    const income = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 1234,
        currency: "PHP",
        description: `e2e unified income ${Date.now()}`,
        date,
        priority: "need",
        status: "posted",
      },
    });
    expect(income.ok()).toBe(true);
    const incomeRow = (await income.json()) as { id: string };
    created.push(`incomes/${incomeRow.id}`);

    const expense = await page.request.post(`${api}/api/budget/expenses`, {
      data: {
        amount: 234,
        currency: "PHP",
        description: `e2e unified expense ${Date.now()}`,
        expense_date: date,
        priority: "want",
        status: "posted",
        is_debt: false,
      },
    });
    expect(expense.ok()).toBe(true);
    const expenseRow = (await expense.json()) as { id: string };
    created.push(`expenses/${expenseRow.id}`);

    const budgetRes = await page.request.get(
      `${api}/api/budget/period-budget?period=day&date=${date}`,
    );
    expect(budgetRes.ok()).toBe(true);
    const budget = (await budgetRes.json()) as { funded: number; spent: number; left: number };

    await page.goto(`/dashboard/budget?period=day&date=${date}`);
    const card = periodCard(page);
    await expect(card).toContainText(peso(Number(budget.funded)));
    await expect(card).toContainText(peso(Number(budget.spent)));
    await expect(card).toContainText(peso(Number(budget.left)));
    await expect(card).toContainText("so far");

    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/period=week/);
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});

test("a past period has no safe-to-spend estimate", async ({ page }) => {
  await page.goto(`/dashboard/budget?period=day&date=${daysAgo(1)}`);
  const card = periodCard(page);
  await expect(card).toContainText("n/a");
  await expect(card).toContainText("past period");
});

test("the headline works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/budget?period=day&date=${today()}`);
  await expect(page.getByText("Money on hand", { exact: true })).toBeVisible();
  await expect(page.getByText("Period budget", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Month", exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("guest mode reads the budget without write actions", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try Demo Mode (Guest Access)" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto(`/dashboard/budget?period=day&date=${today()}`);
  await expect(page.getByText("Money on hand", { exact: true })).toBeVisible();
  await expect(page.getByText("Period budget", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Expense" })).toBeDisabled();
});
