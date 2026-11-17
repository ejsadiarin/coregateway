import { API_URL as api, expect, login, test, type Page } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return ymd(date);
};

type Kind = "income" | "expense";
interface Rule {
  kind: Kind;
  id: string;
}

const path = (kind: Kind) => (kind === "income" ? "recurring-incomes" : "recurring-expenses");

const createRule = async (
  page: Page,
  kind: Kind,
  amount: number,
  currency: string,
  over: { recurring_type?: string; start_date?: string } = {},
): Promise<Rule> => {
  const description = unique(`${currency} ${kind} rule`);
  const res = await page.request.post(`${api}/api/budget/${path(kind)}`, {
    data: {
      amount,
      currency,
      description,
      recurring_type: over.recurring_type ?? "monthly",
      start_date: over.start_date ?? today(),
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

test("PHP-only rule projections keep one line", async ({ page }) => {
  const created: Rule[] = [];
  try {
    created.push(await createRule(page, "income", 1000, "PHP"));
    created.push(
      await createRule(page, "expense", 200, "PHP", {
        recurring_type: "weekly",
        start_date: daysFromToday(-13),
      }),
    );

    await page.goto("/dashboard/budget/incomes");
    const rulesAside = page.getByRole("complementary", { name: "Rules and what's coming" });
    await expect(rulesAside.getByText("₱1,000/mo", { exact: true })).toBeVisible();
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
    created.push(
      await createRule(page, "expense", 200, "PHP", {
        recurring_type: "weekly",
        start_date: daysFromToday(-13),
      }),
    );
    created.push(
      await createRule(page, "expense", 2, "USD", {
        recurring_type: "weekly",
        start_date: daysFromToday(-13),
      }),
    );

    await page.goto("/dashboard/budget/incomes");
    await expect(page.getByRole("heading", { level: 1, name: "Incomes" })).toBeVisible();
    const rulesAside = page.getByRole("complementary", { name: "Rules and what's coming" });
    await expect(rulesAside.getByText("₱1,000/mo + ¥3,000/mo + $5/mo", { exact: true })).toBeVisible();
  } finally {
    for (const rule of created) await removeRule(page, rule);
  }
});
