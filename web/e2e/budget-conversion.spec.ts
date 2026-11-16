import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function incomeCategory(page: import("@playwright/test").Page, name: string) {
  const res = await page.request.get(`${api}/api/budget/income-categories`);
  expect(res.ok()).toBe(true);
  const categories: { id: string; name: string }[] = await res.json();
  const category = categories.find((c) => c.name === name);
  expect(category, `${name} category`).toBeTruthy();
  return category!;
}

// peso matches the ledger's money(): grouped, two decimals unless whole.
const peso = (value: number) => {
  const whole = Number.isInteger(Math.round(value * 100) / 100) && value % 1 === 0;
  return "₱" + Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};

async function incomes(page: import("@playwright/test").Page) {
  const res = await page.request.get(`${api}/api/budget/incomes?page=1&page_size=1000`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    amount: number | string;
    amount_php?: number | string;
    date: string;
    status?: string;
  }[];
}

const totalPHP = (rows: Awaited<ReturnType<typeof incomes>>) =>
  rows
    .filter((i) => (i.status ?? "posted") !== "skipped")
    .reduce((sum, i) => sum + Number(i.amount_php ?? i.amount), 0);

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("entry details show a non-PHP record's fixed PHP conversion", async ({ page }) => {
  const salary = await incomeCategory(page, "salary");
  const usdDescription = unique("USD gift");
  const phpDescription = unique("PHP gift");
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const at = new Date(`${today}T00:00:00`);
  const rateDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(at);
  const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(at);
  // The ledger totals only entries dated today or earlier.
  const past = (await incomes(page)).filter((i) => i.date <= today);
  const expectedMonth = totalPHP(past.filter((i) => i.date.startsWith(today.slice(0, 7)))) + 6157.3 + 500;
  const expectedDay = totalPHP(past.filter((i) => i.date === today)) + 6157.3 + 500;
  const created: string[] = [];
  const remove = async (id: string) => {
    const res = await page.request.delete(`${api}/api/budget/incomes/${id}`);
    expect(res.ok() || res.status() === 404).toBe(true);
  };

  try {
    const usdCreated = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 100,
        currency: "USD",
        date: today,
        description: usdDescription,
        category_id: salary.id,
        priority: "want",
        status: "posted",
      },
    });
    expect(usdCreated.ok()).toBe(true);
    const usd = await usdCreated.json();
    created.push(usd.id);
    expect(usd.exchange_rate).toBe("61.573");
    expect(usd.rate_date).toBe(today);

    const phpCreated = await page.request.post(`${api}/api/budget/incomes`, {
      data: {
        amount: 500,
        currency: "PHP",
        date: today,
        description: phpDescription,
        category_id: salary.id,
        priority: "need",
        status: "posted",
      },
    });
    expect(phpCreated.ok()).toBe(true);
    const php = await phpCreated.json();
    created.push(php.id);

    await page.goto("/dashboard/budget/incomes");
    await expect(page.getByRole("heading", { level: 1, name: "Incomes" })).toBeVisible();

    const monthSection = page.getByRole("region", { name: monthLabel });
    await expect(monthSection).toBeVisible();
    await expect(monthSection.getByRole("button").first()).toContainText(`+${peso(expectedMonth)}`);
    await expect(monthSection.getByText(dayLabel, { exact: true }).locator("..")).toContainText(
      `+${peso(expectedDay)}`,
    );

    await page.getByText(usdDescription, { exact: true }).click();
    const usdDialog = page.getByRole("dialog", { name: usdDescription });
    await expect(usdDialog.getByTestId("conversion")).toHaveText(
      `$100.00 · ₱6,157.30 at 61.573 (${rateDate})`,
    );
    await page.keyboard.press("Escape");
    await expect(usdDialog).toBeHidden();

    await page.getByText(phpDescription, { exact: true }).click();
    const phpDialog = page.getByRole("dialog", { name: phpDescription });
    await expect(phpDialog).toBeVisible();
    await expect(phpDialog.getByTestId("conversion")).toHaveCount(0);
  } finally {
    for (const id of created) await remove(id);
  }
});
