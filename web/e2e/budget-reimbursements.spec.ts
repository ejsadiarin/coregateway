import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

async function incomeCategory(page: import("@playwright/test").Page, name: string) {
  const res = await page.request.get(`${api}/api/budget/income-categories`);
  expect(res.ok()).toBe(true);
  const categories: { id: string; name: string }[] = await res.json();
  const category = categories.find((c) => c.name === name);
  expect(category, `${name} category`).toBeTruthy();
  return category!;
}

async function periodBudget(page: import("@playwright/test").Page, date: string) {
  const res = await page.request.get(
    `${api}/api/budget/period-budget?period=day&date=${date}`,
  );
  expect(res.ok()).toBe(true);
  return (await res.json()) as { funded: number; spent: number };
}

async function moneyOnHand(page: import("@playwright/test").Page) {
  const res = await page.request.get(`${api}/api/budget/current-total-money`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { total_money: number };
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("reimbursements reduce spent and are not funding", async ({ page }) => {
  const date = today();
  const before = await periodBudget(page, date);
  const beforeMoney = await moneyOnHand(page);
  const salary = await incomeCategory(page, "salary");
  const reimbursement = await incomeCategory(page, "reimbursement");

  const created: string[] = [];
  const remove = async (row: string) => {
    const res = await page.request.delete(`${api}/api/budget/${row}`);
    expect(res.ok() || res.status() === 404).toBe(true);
  };

  try {
    const income = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 20000,
        currency: "PHP",
        date,
        description: unique("Salary"),
        category_id: salary.id,
        priority: "need",
        status: "posted",
      },
    });
    expect(income.ok()).toBe(true);
    const incomeRow = (await income.json()) as { id: string };
    created.push(`incomes/${incomeRow.id}`);

    const expense = await page.request.post(`${api}/api/budget/expenses`, {
      data: {
        amount: 600,
        currency: "PHP",
        description: unique("Dinner"),
        expense_date: date,
        priority: "want",
        status: "posted",
        is_debt: false,
      },
    });
    expect(expense.ok()).toBe(true);
    const expenseRow = (await expense.json()) as { id: string };
    created.push(`expenses/${expenseRow.id}`);

    const reimbursementRow = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 500,
        currency: "PHP",
        date,
        description: unique("Shared dinner"),
        category_id: reimbursement.id,
        priority: "need",
        status: "posted",
      },
    });
    expect(reimbursementRow.ok()).toBe(true);
    const reimbursementIncome = (await reimbursementRow.json()) as { id: string };
    created.push(`incomes/${reimbursementIncome.id}`);

    await page.goto(`/dashboard/budget?period=day&date=${date}`);
    const card = page.getByText("Period budget", { exact: true }).locator("..").locator("..");
    // Funding rises by the salary only; spent falls by the reimbursement.
    await expect(card).toContainText(peso(Number(before.funded) + 20000));
    await expect(card).toContainText(peso(Number(before.spent) + 600 - 500));

    const moneyCard = page.getByText("Money on hand", { exact: true }).locator("..").locator("..");
    await expect(moneyCard).toContainText(peso(Number(beforeMoney.total_money) + 20000 + 500 - 600));
  } finally {
    for (const row of created) await remove(row);
  }
});

test("a reimbursement alone never appears as funding", async ({ page }) => {
  const date = today();
  const before = await periodBudget(page, date);
  const reimbursement = await incomeCategory(page, "reimbursement");
  const created: string[] = [];

  try {
    const res = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 750,
        currency: "PHP",
        date,
        description: unique("Shared fare"),
        category_id: reimbursement.id,
        priority: "need",
        status: "posted",
      },
    });
    expect(res.ok()).toBe(true);
    const row = (await res.json()) as { id: string };
    created.push(`incomes/${row.id}`);

    await page.goto(`/dashboard/budget?period=day&date=${date}`);
    const card = page.getByText("Period budget", { exact: true }).locator("..").locator("..");
    await expect(card).toContainText(peso(Number(before.funded)));
    await expect(card).toContainText(peso(Number(before.spent) - 750));
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});
