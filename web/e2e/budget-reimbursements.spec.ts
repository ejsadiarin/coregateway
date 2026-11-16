import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

// The budget pages' default ranges: local date arithmetic, UTC formatting.
function range(daysBack: number) {
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - daysBack);
  return { startDate: fmt(start), endDate: fmt(today) };
}

async function incomeCategory(page: import("@playwright/test").Page, name: string) {
  const res = await page.request.get(`${api}/api/budget/income-categories`);
  expect(res.ok()).toBe(true);
  const categories: { id: string; name: string }[] = await res.json();
  const category = categories.find((c) => c.name === name);
  expect(category, `${name} category`).toBeTruthy();
  return category!;
}

async function summary(page: import("@playwright/test").Page, startDate: string, endDate: string) {
  const res = await page.request.get(
    `${api}/api/budget/stats/summary?start_date=${startDate}&end_date=${endDate}`,
  );
  expect(res.ok()).toBe(true);
  return res.json() as Promise<{ total_incomes: number; total_reimbursements: number }>;
}

async function totalMoney(page: import("@playwright/test").Page) {
  const res = await page.request.get(`${api}/api/budget/current-total-money`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { total_money: number };
}

async function allTimeSplit(page: import("@playwright/test").Page) {
  const res = await page.request.get(`${api}/api/budget/analysis/503020`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { total_incomes: number; total_reimbursements: number };
}

async function monthlyTrends(page: import("@playwright/test").Page) {
  const res = await page.request.get(`${api}/api/budget/stats/trends`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    month: string;
    total_incomes: number;
    total_reimbursements: number;
  }[];
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("income excludes reimbursements and shows them beside it", async ({ page }) => {
  const week = range(6);
  const month = range(29);
  const beforeWeek = await summary(page, week.startDate, week.endDate);
  const beforeMonth = await summary(page, month.startDate, month.endDate);
  const beforeAll = await allTimeSplit(page);
  const beforeTrends = await monthlyTrends(page);
  const beforeMoney = await totalMoney(page);
  const salary = await incomeCategory(page, "salary");
  const reimbursement = await incomeCategory(page, "reimbursement");
  const { endDate } = week;

  const createIncome = async (description: string, amount: number, categoryId: string) => {
    const res = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount,
        currency: "PHP",
        date: endDate,
        description,
        category_id: categoryId,
        priority: "need",
        status: "posted",
      },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { id: string };
  };

  const created: string[] = [];
  const remove = async (id: string) => {
    const res = await page.request.delete(`${api}/api/budget/incomes/${id}`);
    expect(res.ok() || res.status() === 404).toBe(true);
  };

  try {
    const salaryRow = await createIncome(unique("Salary"), 20000, salary.id);
    created.push(salaryRow.id);
    const reimbursementRow = await createIncome(unique("Shared dinner"), 500, reimbursement.id);
    created.push(reimbursementRow.id);

    const expectedIncome = Number(beforeWeek.total_incomes) + 20000;
    const expectedWeekReimbursements = Number(beforeWeek.total_reimbursements) + 500;
    const expectedMonthReimbursements = Number(beforeMonth.total_reimbursements) + 500;
    const expectedAllIncome = Number(beforeAll.total_incomes) + 20000;
    const expectedAllReimbursements = Number(beforeAll.total_reimbursements) + 500;
    const currentMonth = beforeTrends.find((t) => t.month === endDate.slice(0, 7));
    const expectedTrendIncome = Number(currentMonth?.total_incomes ?? 0) + 20000;
    const expectedTrendReimbursements = Number(currentMonth?.total_reimbursements ?? 0) + 500;
    const expectedMoney = Number(beforeMoney.total_money) + 20500;

    await page.goto("/dashboard/budget");
    const incomeCard = page.getByText("Total Income", { exact: true }).locator("..").locator("..");
    await expect(incomeCard).toContainText(peso(expectedIncome));
    await expect(incomeCard).toContainText("Reimbursements");
    await expect(incomeCard).toContainText(peso(expectedWeekReimbursements));

    const savingsCard = page.getByText("Savings Rate", { exact: true }).locator("..").locator("..");
    await expect(savingsCard).toContainText(peso(expectedIncome));
    await expect(savingsCard).toContainText("Reimbursements");
    await expect(savingsCard).toContainText(peso(expectedWeekReimbursements));

    // Money on hand still counts the reimbursement.
    const moneyCard = page.getByText("Total Money · lifetime", { exact: true }).locator("..").locator("..");
    await expect(moneyCard).toContainText(peso(expectedMoney));

    // The experimental budget pages read the same reports over 30 days or all
    // time.
    for (const path of ["/dashboard/budget2", "/dashboard/budget3"]) {
      await page.goto(path);
      await expect(page.getByText("Reimbursements").first()).toBeVisible();
      await expect(page.getByText(peso(expectedMonthReimbursements)).first()).toBeVisible();
    }
    await page.goto("/dashboard/budget4");
    const latestMonthCard = page.getByText(/^Income · /).locator("..");
    await expect(latestMonthCard).toContainText(`Latest month income: ${peso(expectedTrendIncome)}`);
    await expect(latestMonthCard).toContainText("Reimbursements");
    await expect(latestMonthCard).toContainText(peso(expectedTrendReimbursements));

    const splitSection = page.getByRole("heading", { name: "50 / 30 / 20 allocation" }).locator("..");
    await expect(splitSection).toContainText(`Income (all time) ${peso(expectedAllIncome)}`);
    await expect(splitSection).toContainText("Reimbursements");
    await expect(splitSection).toContainText(peso(expectedAllReimbursements));

    // With no reimbursement left in the period, the figure hides.
    await remove(reimbursementRow.id);
    await page.goto("/dashboard/budget");
    await expect(page.getByText("Reimbursements")).toHaveCount(0);
  } finally {
    for (const id of created) await remove(id);
  }
});
