import { withDueDates, type Entry, type Rule } from "@/lib/ledger";

export type UpcomingDue = Rule & { dates: string[] };

// upcomingDues finds each active expense rule's due dates inside the window,
// using the entries already made for that rule.
export function upcomingDues(
  rules: Rule[],
  entries: Pick<Entry, "ruleId" | "date">[],
  from: string,
  until: string,
): UpcomingDue[] {
  return withDueDates(rules, entries, from, until).filter((due) => due.dates.length > 0);
}

// dueAmounts repeats a rule's amount for every date it falls on, so a total
// due counts each due date.
export function dueAmounts(due: UpcomingDue[]): { amount: number; currency: string }[] {
  return due.flatMap((rule) => rule.dates.map(() => ({ amount: rule.amount, currency: rule.currency })));
}
