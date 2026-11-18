import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return ymd(date);
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("coming up shows rules and future expenses for the next 7 days", async ({ page }) => {
  const incomeDescription = unique("Upcoming income");
  const expenseDescription = unique("Upcoming bill");
  const futureDescription = unique("Upcoming installment");
  const created: string[] = [];

  const createRule = async (kind: "income" | "expense", amount: number, start: string, description: string) => {
    const res = await page.request.post(`${api}/api/budget/recurring-${kind}s`, {
      data: {
        amount,
        currency: "PHP",
        description,
        recurring_type: "monthly",
        start_date: start,
        priority: kind === "income" ? "want" : "need",
      },
    });
    expect(res.ok()).toBe(true);
    const rule = (await res.json()) as { id: string };
    created.push(`recurring-${kind}s/${rule.id}`);
  };

  try {
    await createRule("income", 1000, daysFromToday(1), incomeDescription);
    await createRule("expense", 200, daysFromToday(2), expenseDescription);

    const future = await page.request.post(`${api}/api/budget/expenses`, {
      data: {
        amount: 300,
        currency: "PHP",
        description: futureDescription,
        expense_date: daysFromToday(3),
        priority: "want",
        status: "pending",
        is_debt: false,
      },
    });
    expect(future.ok()).toBe(true);
    const futureRow = (await future.json()) as { id: string };
    created.push(`expenses/${futureRow.id}`);

    // Anchored on today even when a past period is selected.
    await page.goto(`/dashboard/budget?period=day&date=${daysFromToday(-3)}`);
    const card = page.getByTestId("coming-up-card");

    await expect(card).toContainText(incomeDescription);
    await expect(card).toContainText(expenseDescription);
    await expect(card).toContainText(futureDescription);

    await expect(card).toContainText("income");
    await expect(card).toContainText("expense");
    await expect(card).toContainText(peso(1000));
    await expect(card).toContainText(peso(200));
    await expect(card).toContainText(peso(300));
    await expect(card).toContainText(peso(500));
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});
