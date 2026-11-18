import { addDays, format, startOfDay } from "date-fns";
import { withDueDates, type Entry, type LedgerKind, type Rule } from "@/lib/ledger";

export interface UpcomingWindow {
  from: string;
  until: string;
}

export interface UpcomingItem {
  key: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  kind: LedgerKind;
}

/** The seven calendar days starting today. */
export function sevenDayWindow(now = new Date()): UpcomingWindow {
  const start = startOfDay(now);
  return {
    from: format(start, "yyyy-MM-dd"),
    until: format(addDays(start, 6), "yyyy-MM-dd"),
  };
}

/**
 * comingUp lists the rule entries and future-dated expenses in the window,
 * sorted by date. Rules reuse the ledger projection, so paused and ended
 * rules drop out and dates with an entry already aren't projected again.
 * Future-dated expenses are real records, so they appear once; a rule entry
 * written ahead of time is one of them, not a second item.
 */
export function comingUp(
  expenseRules: Rule[],
  expenseEntries: Entry[],
  incomeRules: Rule[],
  incomeEntries: Entry[],
  window: UpcomingWindow,
): UpcomingItem[] {
  const items: UpcomingItem[] = [];

  for (const rule of withDueDates(expenseRules, expenseEntries, window.from, window.until)) {
    for (const date of rule.dates) {
      items.push({
        key: `expense-rule-${rule.id}-${date}`,
        date,
        description: rule.description,
        amount: rule.amount,
        currency: rule.currency,
        kind: "expense",
      });
    }
  }
  for (const rule of withDueDates(incomeRules, incomeEntries, window.from, window.until)) {
    for (const date of rule.dates) {
      items.push({
        key: `income-rule-${rule.id}-${date}`,
        date,
        description: rule.description,
        amount: rule.amount,
        currency: rule.currency,
        kind: "income",
      });
    }
  }
  for (const entry of expenseEntries) {
    if (entry.kind !== "expense" || entry.status === "skipped") continue;
    if (entry.date <= window.from || entry.date > window.until) continue;
    items.push({
      key: `expense-${entry.id}`,
      date: entry.date,
      description: entry.description,
      amount: entry.amount,
      currency: entry.currency,
      kind: "expense",
    });
  }

  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.kind.localeCompare(b.kind) ||
      a.description.localeCompare(b.description),
  );
}

/** Income minus expenses, one subtotal per currency. */
export function comingUpNet(items: UpcomingItem[]): Map<string, number> {
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    const code = (item.currency || "PHP").toUpperCase();
    const signed = item.kind === "income" ? item.amount : -item.amount;
    byCurrency.set(code, (byCurrency.get(code) ?? 0) + signed);
  }
  return byCurrency;
}
