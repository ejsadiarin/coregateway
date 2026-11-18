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

interface Bucket {
  start_date: string;
  end_date: string;
  income: number;
  spent: number;
  net: number;
}

async function series(page: import("@playwright/test").Page, bucket: "day" | "week" | "month") {
  const count = bucket === "day" ? 14 : bucket === "week" ? 8 : 6;
  const res = await page.request.get(
    `${api}/api/budget/cash-flow?bucket=${bucket}&count=${count}`,
  );
  expect(res.ok()).toBe(true);
  const data = (await res.json()) as { buckets: Bucket[] };
  return data.buckets;
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("cash flow follows the period kind and shows the current bucket", async ({ page }) => {
  const created: string[] = [];
  try {
    for (const [amount, date] of [
      [1000, today()],
      [400, today()],
      [200, daysAgo(2)],
    ] as const) {
      const res = await page.request.post(`${api}/api/budget/expenses`, {
        data: {
          amount,
          currency: "PHP",
          description: unique("Cash flow"),
          expense_date: date,
          priority: "want",
          status: "posted",
          is_debt: false,
        },
      });
      expect(res.ok()).toBe(true);
      created.push(`expenses/${((await res.json()) as { id: string }).id}`);
    }
    const income = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 1000,
        currency: "PHP",
        description: unique("Cash flow income"),
        date: today(),
        priority: "want",
        status: "posted",
      },
    });
    expect(income.ok()).toBe(true);
    created.push(`incomes/${((await income.json()) as { id: string }).id}`);

    const daily = await series(page, "day");
    const todayBucket = daily[daily.length - 1];
    const earlier = daily[daily.length - 3];

    await page.goto(`/dashboard/budget?period=day&date=${today()}`);
    const card = page.getByTestId("cash-flow-card");

    await expect(card).toContainText("Last 14 days");
    await expect(card.getByRole("button")).toHaveCount(14);
    await expect(card.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(card.locator('[aria-current="true"]')).toContainText("now");

    await expect(card).toContainText(`${peso(Number(todayBucket.income))} income`);
    await expect(card).toContainText(`${peso(Number(todayBucket.spent))} spent`);
    await expect(card).toContainText(`${peso(Number(todayBucket.net))} net`);

    // On a phone the current bucket is scrolled into view, not hidden at the
    // right edge of the strip.
    await page.setViewportSize({ width: 390, height: 844 });
    const atEnd = await page.getByTestId("cash-flow-strip").evaluate(
      (element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
    );
    expect(atEnd).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Hovering or tapping another bar shows that bucket's numbers.
    await card.getByRole("button").nth(daily.length - 3).hover();
    await expect(card).toContainText(`${peso(Number(earlier.spent))} spent`);

    await page.getByRole("button", { name: "Week", exact: true }).click();
    const weekly = await series(page, "week");
    const weekBucket = weekly[weekly.length - 1];
    await expect(card).toContainText("Last 8 weeks");
    await expect(card.getByRole("button")).toHaveCount(8);
    await expect(card).toContainText(`${peso(Number(weekBucket.net))} net`);

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(card).toContainText("Last 6 months");
    await expect(card.getByRole("button")).toHaveCount(6);
  } finally {
    for (const row of created) {
      const res = await page.request.delete(`${api}/api/budget/${row}`);
      expect(res.ok() || res.status() === 404).toBe(true);
    }
  }
});

test("cash flow fits a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/budget?period=day&date=${today()}`);
  const card = page.getByTestId("cash-flow-card");
  await expect(card).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
