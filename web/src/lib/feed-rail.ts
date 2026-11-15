// The pure parts of the Feed's budget notes and its side rail: skipping one
// date of a rule entry, the chips a budget note shows, and the rail's
// calendar, coming-up list and month summary.

import { addDays, format, getDay, getDaysInMonth, parseISO } from "date-fns";
import { cadenceLabel, ruleLabel, type Cadence } from "@/lib/ledger";

type Status = "pending" | "posted" | "skipped";

// canSkip tells a record that can be skipped for its date alone: a rule
// entry. A record typed by hand is deleted instead.
export const canSkip = (r: { source_rule_id?: string | null }) => !!r.source_rule_id;

// skipStatus is the status to save to skip a record, or to undo a skip:
// undefined lets its date decide between posted and pending.
export const skipStatus = (current: Status | undefined): Status | undefined =>
  current === "skipped" ? undefined : "skipped";

// BudgetChips are the chips under a budget note: its category, the rule
// that made it ("Monthly · Spotify"; just "rule" once the rule is gone),
// its tags, and its status when that isn't posted.
export interface BudgetChips<C, T> {
  category: C | undefined;
  rule: string | undefined;
  tags: T[];
  status: "pending" | "skipped" | undefined;
}

// budgetChips works out a budget note's chips from its record and the
// owner's categories, rules and tags, as the ledger shows them.
export function budgetChips<C, T>(
  record: { id: string; category_id?: string | null; source_rule_id?: string | null; status?: Status },
  ctx: {
    categoryById: Map<string, C>;
    ruleById: Map<string, { description: string; cadence: Cadence }>;
    tagIds: Map<string, string[]>;
    tagById: Map<string, T>;
  },
): BudgetChips<C, T> {
  const ruleId = record.source_rule_id;
  const rule = ruleId ? ctx.ruleById.get(ruleId) : undefined;
  const status = record.status === "pending" || record.status === "skipped" ? record.status : undefined;
  return {
    category: record.category_id ? ctx.categoryById.get(record.category_id) : undefined,
    rule: !ruleId ? undefined : rule ? `${cadenceLabel(rule.cadence)} · ${rule.description}` : ruleLabel(ruleId, ctx.ruleById),
    tags: (ctx.tagIds.get(record.id) ?? []).flatMap((id) => {
      const t = ctx.tagById.get(id);
      return t ? [t] : [];
    }),
    status,
  };
}

// DayCell is one day of the rail's calendar. net is its budget records'
// income less spending (skipped ones don't count), undefined with none;
// dot marks a day with any notes or records.
export interface DayCell {
  date: string; // yyyy-MM-dd
  day: number;
  net: number | undefined;
  dot: boolean;
  today: boolean;
  future: boolean;
}

// monthDays lays out a month ("2026-11") Sunday first: blanks (null)
// before its first day, then each day.
export function monthDays(
  month: string,
  entries: { date: string; kind: "expense" | "income"; amount: number; status: Status }[],
  noteDays: Set<string>,
  today: string,
): (DayCell | null)[] {
  const first = parseISO(`${month}-01`);
  const nets = new Map<string, number>();
  for (const e of entries) {
    if (e.status === "skipped" || !e.date.startsWith(month)) continue;
    nets.set(e.date, (nets.get(e.date) ?? 0) + (e.kind === "income" ? e.amount : -e.amount));
  }
  const cells: (DayCell | null)[] = Array.from({ length: getDay(first) }, () => null);
  for (let day = 1; day <= getDaysInMonth(first); day++) {
    const date = `${format(first, "yyyy-MM")}-${String(day).padStart(2, "0")}`;
    const net = nets.get(date);
    cells.push({ date, day, net, dot: net !== undefined || noteDays.has(date), today: date === today, future: date > today });
  }
  return cells;
}

// ComingItem is one thing in the rail's next seven days: a reminder about
// to fire, or a rule entry about to post.
export interface ComingItem {
  key: string;
  date: string; // yyyy-MM-dd, local
  time?: string; // HH:mm, reminders only
  kind: "reminder" | "rule";
  title: string;
  amount?: number;
  currency?: string;
  ruleKind?: "expense" | "income";
}

// comingUp lists, soonest first, the reminders that fire and the rules that
// post in the seven days from now's date. A paused reminder (one that
// won't be sent) and a rule with no next date are left out.
export function comingUp(
  reminders: { id: string; message: string; next_fire_at: string | null; paused: string | null }[],
  rules: { id: string; kind: "expense" | "income"; description: string; amount: number; currency: string; next: string | undefined }[],
  now: Date,
): ComingItem[] {
  const from = format(now, "yyyy-MM-dd");
  const until = format(addDays(now, 6), "yyyy-MM-dd");
  const inRange = (d: string) => d >= from && d <= until;
  const items: (ComingItem & { sort: string })[] = [];
  for (const r of reminders) {
    if (!r.next_fire_at || r.paused) continue;
    const at = new Date(r.next_fire_at);
    const date = format(at, "yyyy-MM-dd");
    if (!inRange(date)) continue;
    const time = format(at, "HH:mm");
    items.push({ key: `reminder:${r.id}`, date, time, kind: "reminder", title: r.message, sort: `${date} ${time}` });
  }
  for (const r of rules) {
    if (!r.next || !inRange(r.next)) continue;
    items.push({
      key: `rule:${r.id}`,
      date: r.next,
      kind: "rule",
      title: r.description,
      amount: r.amount,
      currency: r.currency,
      ruleKind: r.kind,
      sort: `${r.next} 99`,
    });
  }
  return items.sort((a, b) => a.sort.localeCompare(b.sort)).map(({ sort: _sort, ...item }) => item);
}

// MonthSummary is the rail's "This month": what went out, what came in,
// what is left, and the share of the income spent (0–100), undefined
// when nothing came in.
export interface MonthSummary {
  spent: number;
  received: number;
  left: number;
  pct: number | undefined;
}

// monthSummary reads corefinance's remaining-budget answer for the month.
export function monthSummary(r: { total_income: number; total_expense: number; remaining: number }): MonthSummary {
  const pct = r.total_income > 0 ? Math.min(100, Math.round((r.total_expense / r.total_income) * 100)) : undefined;
  return { spent: r.total_expense, received: r.total_income, left: r.remaining, pct };
}
