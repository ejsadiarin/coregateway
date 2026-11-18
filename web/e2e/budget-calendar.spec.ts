import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => new Date();
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

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("calendar marks no-spend days and selects a tapped date", async ({ page }) => {
  const now = today();
  const todayISO = ymd(now);
  const firstOfMonth = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const created: string[] = [];

  const addExpense = async (amount: number, date: string) => {
    const res = await page.request.post(`${api}/api/budget/expenses`, {
      data: {
        amount,
        currency: "PHP",
        description: unique("Calendar"),
        expense_date: date,
        priority: "want",
        status: "posted",
        is_debt: false,
      },
    });
    expect(res.ok()).toBe(true);
    created.push(`expenses/${((await res.json()) as { id: string }).id}`);
  };

  try {
    await addExpense(250, todayISO);
    await addExpense(100, daysAgo(2));

    const dayCount = now.getDate();
    const seriesRes = await page.request.get(
      `${api}/api/budget/cash-flow?bucket=day&count=${dayCount}`,
    );
    expect(seriesRes.ok()).toBe(true);
    const series = (await seriesRes.json()) as {
      buckets: { start_date: string; spent: number }[];
    };
    const noSpend = series.buckets.filter((bucket) => Number(bucket.spent) === 0).length;
    const todaySpent = series.buckets.find((bucket) => bucket.start_date === todayISO)?.spent ?? 0;

    await page.goto(`/dashboard/budget?period=day&date=${todayISO}`);
    const card = page
      .getByRole("heading", { name: "Spending calendar" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");

    await expect(card).toContainText(`${noSpend} no-spend days so far`);
    await expect(card.getByRole("button", { name: new RegExp(`^${now.getDate()} .*${peso(Number(todaySpent))}`) })).toBeVisible();

    // Future days are blank, not zero.
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getDate() < lastDay) {
      await expect(card.getByRole("button", { name: /upcoming/ }).first()).toBeDisabled();
    }

    await card.getByRole("button", { name: /^1 .*:/ }).click();
    await expect(page).toHaveURL(new RegExp(`period=day.*date=${firstOfMonth}`));
    await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});

test("calendar fits a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/budget?period=day&date=${ymd(today())}`);
  const card = page
    .getByRole("heading", { name: "Spending calendar" })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await expect(card).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
