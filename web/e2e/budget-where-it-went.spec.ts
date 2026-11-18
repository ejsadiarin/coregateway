import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

async function expenseCategory(page: import("@playwright/test").Page, name: string) {
  const res = await page.request.get(`${api}/api/budget/expense-categories`);
  expect(res.ok()).toBe(true);
  const categories: { id: string; name: string }[] = await res.json();
  const category = categories.find((c) => c.name === name);
  expect(category, `${name} category`).toBeTruthy();
  return category!;
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("categories show amount, share and change from the previous period", async ({ page }) => {
  const food = await expenseCategory(page, "food");
  const transportation = await expenseCategory(page, "transportation");
  const created: string[] = [];

  const addExpense = async (amount: number, date: string, categoryId: string, priority: string) => {
    const res = await page.request.post(`${api}/api/budget/expenses`, {
      data: {
        amount,
        currency: "PHP",
        description: unique("Where it went"),
        expense_date: date,
        category_id: categoryId,
        priority,
        status: "posted",
        is_debt: false,
      },
    });
    expect(res.ok()).toBe(true);
    const row = (await res.json()) as { id: string };
    created.push(`expenses/${row.id}`);
  };

  try {
    await addExpense(100, today(), food.id, "need");
    await addExpense(300, today(), transportation.id, "want");
    await addExpense(50, daysAgo(1), food.id, "need");
    await addExpense(500, daysAgo(1), transportation.id, "want");

    await page.goto(`/dashboard/budget?period=day&date=${today()}`);
    const card = page.getByText("Where it went", { exact: true }).locator("..").locator("..");

    await expect(card).toContainText("food");
    await expect(card).toContainText(peso(100));
    await expect(card).toContainText("25%");
    await expect(card).toContainText(`+${peso(50)}`);

    await expect(card).toContainText("transportation");
    await expect(card).toContainText(peso(300));
    await expect(card).toContainText("75%");
    await expect(card).toContainText(`−${peso(200)}`);

    await expect(card).not.toContainText("subscriptions");

    const splitRes = await page.request.get(
      `${api}/api/budget/analysis/503020?start_date=${today()}&end_date=${today()}`,
    );
    expect(splitRes.ok()).toBe(true);
    const split = (await splitRes.json()) as {
      needs: number;
      wants: number;
      total_expenses: number;
    };
    await expect(card).toContainText("Needs");
    await expect(card).toContainText(peso(Number(split.needs)));
    await expect(card).toContainText("Wants");
    await expect(card).toContainText(peso(Number(split.wants)));
    await expect(card).toContainText("Total spent");
    await expect(card).toContainText(peso(Number(split.total_expenses)));

    // An empty day says so instead of showing an empty grid.
    await page.goto(`/dashboard/budget?period=day&date=${daysAgo(3)}`);
    await expect(
      page.getByText("Where it went", { exact: true }).locator("..").locator(".."),
    ).toContainText("No spending in this period.");
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});

test("a category with no previous spending is marked new", async ({ page }) => {
  const travel = await expenseCategory(page, "travel");
  const created: string[] = [];
  try {
    const res = await page.request.post(`${api}/api/budget/expenses`, {
      data: {
        amount: 250,
        currency: "PHP",
        description: unique("New category"),
        expense_date: today(),
        category_id: travel.id,
        priority: "want",
        status: "posted",
        is_debt: false,
      },
    });
    expect(res.ok()).toBe(true);
    const row = (await res.json()) as { id: string };
    created.push(`expenses/${row.id}`);

    await page.goto(`/dashboard/budget?period=day&date=${today()}`);
    const card = page.getByText("Where it went", { exact: true }).locator("..").locator("..");
    await expect(card).toContainText("travel");
    await expect(card).toContainText("new");
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});
