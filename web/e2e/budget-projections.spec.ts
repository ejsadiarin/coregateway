import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

type Kind = "income" | "expense";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("rule projections show one subtotal per currency when mixed", async ({ page }) => {
  const created: { kind: Kind; id: string }[] = [];
  const path = (kind: Kind) => (kind === "income" ? "recurring-incomes" : "recurring-expenses");
  const create = async (kind: Kind, amount: number, currency: string) => {
    const res = await page.request.post(`${api}/api/budget/${path(kind)}`, {
      data: {
        amount,
        currency,
        description: unique(`${currency} ${kind} rule`),
        recurring_type: "monthly",
        start_date: today(),
        priority: kind === "income" ? "want" : "need",
      },
    });
    expect(res.ok()).toBe(true);
    const rule = await res.json();
    created.push({ kind, id: rule.id });
  };
  const remove = async ({ kind, id }: { kind: Kind; id: string }) => {
    const res = await page.request.delete(`${api}/api/budget/${path(kind)}/${id}`);
    expect(res.ok() || res.status() === 404).toBe(true);
  };

  try {
    await create("income", 1000, "PHP");
    await create("income", 5, "USD");
    await create("income", 3000, "JPY");
    await create("expense", 200, "PHP");
    await create("expense", 2, "USD");

    await page.goto("/dashboard/budget/incomes");
    await expect(page.getByRole("heading", { level: 1, name: "Incomes" })).toBeVisible();
    const rulesAside = page.getByRole("complementary", { name: "Rules and what's coming" });
    await expect(rulesAside.getByText("₱1,000/mo + ¥3,000/mo + $5/mo", { exact: true })).toBeVisible();

    await page.goto("/dashboard/budget");
    const cashFlow = page.getByText("Recurring Cash Flow", { exact: true }).locator("..").locator("..");
    const income = cashFlow.getByText("Income", { exact: true }).locator("..");
    await expect(income).toContainText("₱1,000.00");
    await expect(income).toContainText("¥3,000.00");
    await expect(income).toContainText("$5.00");

    const expenses = cashFlow.getByText("Expenses", { exact: true }).locator("..");
    await expect(expenses).toContainText("₱200.00");
    await expect(expenses).toContainText("$2.00");

    const net = cashFlow.getByText("Net cash flow", { exact: true }).locator("..");
    await expect(net).toContainText("+₱800.00");
    await expect(net).toContainText("+¥3,000.00");
    await expect(net).toContainText("+$3.00");

    const totalDue = page.getByText("Total due", { exact: true }).locator("..");
    await expect(totalDue).toContainText("₱200.00");
    await expect(totalDue).toContainText("$2.00");
  } finally {
    for (const rule of created) await remove(rule);
  }
});
