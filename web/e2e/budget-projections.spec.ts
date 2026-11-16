import { API_URL as api, expect, login, test, type Page } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

type Kind = "income" | "expense";
interface Rule {
  kind: Kind;
  id: string;
}

const path = (kind: Kind) => (kind === "income" ? "recurring-incomes" : "recurring-expenses");

const createRule = async (page: Page, kind: Kind, amount: number, currency: string): Promise<Rule> => {
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
  return { kind, id: rule.id };
};

const removeRule = async (page: Page, rule: Rule) => {
  const res = await page.request.delete(`${api}/api/budget/${path(rule.kind)}/${rule.id}`);
  expect(res.ok() || res.status() === 404).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("PHP-only rule projections keep one peso line", async ({ page }) => {
  const created: Rule[] = [];
  try {
    created.push(await createRule(page, "income", 1000, "PHP"));
    created.push(await createRule(page, "expense", 200, "PHP"));

    await page.goto("/dashboard/budget/incomes");
    const rulesAside = page.getByRole("complementary", { name: "Rules and what's coming" });
    await expect(rulesAside.getByText("₱1,000/mo", { exact: true })).toBeVisible();

    await page.goto("/dashboard/budget");
    const cashFlow = page.getByText("Recurring Cash Flow", { exact: true }).locator("..").locator("..");
    await expect(cashFlow.getByText("Income", { exact: true }).locator("..")).toContainText("₱1,000.00");
    await expect(cashFlow.getByText("Expenses", { exact: true }).locator("..")).toContainText("₱200.00");
    await expect(cashFlow.getByText("Net cash flow", { exact: true }).locator("..")).toContainText("+₱800.00");
    await expect(page.getByText("Total due", { exact: true }).locator("..")).toContainText("₱200.00");
  } finally {
    for (const rule of created) await removeRule(page, rule);
  }
});

test("rule projections show one subtotal per currency when mixed", async ({ page }) => {
  const created: Rule[] = [];
  try {
    created.push(await createRule(page, "income", 1000, "PHP"));
    created.push(await createRule(page, "income", 5, "USD"));
    created.push(await createRule(page, "income", 3000, "JPY"));
    created.push(await createRule(page, "expense", 200, "PHP"));
    created.push(await createRule(page, "expense", 2, "USD"));

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
    for (const rule of created) await removeRule(page, rule);
  }
});
