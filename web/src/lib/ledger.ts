import { addDays, addMonths, addYears, format, getDate, getDaysInMonth, parseISO, setDate } from "date-fns";
import type { Category, Expense, Income } from "@/types/api";

// The Expenses and Incomes pages share one layout: the rules on top, the
// entries still ahead, then every entry grouped by month and day. This
// file holds the pure parts of it.

export type LedgerKind = "expense" | "income";
export type Cadence = "daily" | "weekly" | "monthly" | "yearly";
export type Priority = "need" | "want" | "savings";

// Entry is an expense or an income as these pages show it.
export interface Entry {
  id: string;
  kind: LedgerKind;
  description: string;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  categoryId?: string;
  notes: string; // without the backfill marker
  marker?: string; // the backfill marker, kept when the entry is saved again
  priority: Priority;
  status: "pending" | "posted" | "skipped";
  ruleId?: string;
  createdAt: string;
}

// Rule is a recurring rule as these pages show it.
export interface Rule {
  id: string;
  kind: LedgerKind;
  description: string;
  amount: number;
  currency: string;
  cadence: Cadence;
  startDate: string;
  endDate?: string;
  categoryId?: string;
  notes: string;
  priority: Priority;
  active: boolean;
}

const day = (s: string | undefined | null) => (s ? s.slice(0, 10) : "");

// cleanNotes hides the marker the November backfill left on the entries it
// imported ("[backfill:messenger-2026-11] dump L846"); the marker stays in
// the database.
export function cleanNotes(notes?: string | null): string {
  return (notes ?? "")
    .replace(/\[backfill:[^\]]*\]/g, "")
    .replace(/(^|\s)dump L\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function entryOf(kind: LedgerKind, r: Expense | Income): Entry {
  return {
    id: r.id,
    kind,
    description: r.description ?? "",
    amount: Number(r.amount),
    currency: r.currency || "PHP",
    date: day("expense_date" in r ? r.expense_date : r.date),
    categoryId: r.category_id || undefined,
    notes: cleanNotes(r.notes),
    marker: r.notes?.match(/\[backfill:[^\]]*\]/)?.[0],
    priority: (r.priority as Priority) || "want",
    status: r.status || "posted",
    ruleId: r.source_rule_id || undefined,
    createdAt: r.created_at,
  };
}

// RawRule is a rule as corefinance lists it.
export interface RawRule {
  id: string;
  amount: number | string;
  currency: string;
  description: string;
  category_id?: string | null;
  notes?: string | null;
  recurring_type: string;
  start_date: string;
  end_date?: string | null;
  priority?: string | null;
  is_active?: boolean;
}

export function ruleOf(kind: LedgerKind, r: RawRule): Rule {
  return {
    id: r.id,
    kind,
    description: r.description,
    amount: Number(r.amount),
    currency: r.currency || "PHP",
    cadence: r.recurring_type as Cadence,
    startDate: day(r.start_date),
    endDate: day(r.end_date) || undefined,
    categoryId: r.category_id || undefined,
    notes: cleanNotes(r.notes),
    priority: (r.priority as Priority) || "want",
    active: r.is_active ?? true,
  };
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
export const today = () => ymd(new Date());

// nthDue is a rule's nth date from its start. A monthly or yearly rule
// keeps its start day and falls on a short month's last day, as the
// worker does (corefinance materialize.DueDates).
function nthDue(start: Date, cadence: Cadence, n: number): Date {
  switch (cadence) {
    case "daily":
      return addDays(start, n);
    case "weekly":
      return addDays(start, 7 * n);
    case "monthly": {
      const m = addMonths(setDate(start, 1), n);
      return setDate(m, Math.min(getDate(start), getDaysInMonth(m)));
    }
    case "yearly": {
      const y = addYears(setDate(start, 1), n);
      return setDate(y, Math.min(getDate(start), getDaysInMonth(y)));
    }
  }
}

// nextDue is the first date on or after `from` the rule is due that it
// hasn't made an entry for yet (a skipped date has an entry too), or
// undefined once it has ended. A paused rule has no next date.
export function nextDue(rule: Rule, made: Set<string>, from: string = today()): string | undefined {
  if (!rule.active || !rule.startDate) return undefined;
  const start = parseISO(rule.startDate);
  for (let n = 0; n < 5000; n++) {
    const d = ymd(nthDue(start, rule.cadence, n));
    if (rule.endDate && d > rule.endDate) return undefined;
    if (d >= from && !made.has(d)) return d;
  }
  return undefined;
}

// ended tells a rule whose last date has passed.
// ruleLabel names the rule that made an entry, or says just "rule" when
// that rule is gone.
export const ruleLabel = (ruleId: string, rules: Map<string, Pick<Rule, "description">>) =>
  rules.get(ruleId)?.description || "rule";

export const ended = (rule: Rule, from: string = today()) => !!rule.endDate && rule.endDate < from;

export function cadenceLabel(c: Cadence): string {
  return { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[c];
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

// cadencePhrase says when a rule repeats: "every Thursday", "on the 23rd
// of every month".
export function cadencePhrase(c: Cadence, start: string): string {
  const d = parseISO(start);
  switch (c) {
    case "daily":
      return "every day";
    case "weekly":
      return `every ${format(d, "EEEE")}`;
    case "monthly":
      return `on the ${ordinal(getDate(d))} of every month`;
    case "yearly":
      return `every ${format(d, "MMM d")}`;
  }
}

// perMonth and perYear add up what the active rules come to.
export function ruleTotals(rules: Rule[]): { perMonth: number; perYear: number } {
  let perMonth = 0;
  let perYear = 0;
  for (const r of rules) {
    if (r.cadence === "yearly") perYear += r.amount;
    else perMonth += r.amount * { daily: 30, weekly: 52 / 12, monthly: 1 }[r.cadence];
  }
  return { perMonth: Math.round(perMonth), perYear: Math.round(perYear) };
}

export type Source = "all" | "rule" | "hand";

export interface Filter {
  source: Source;
  categoryId?: string;
}

export function applyFilter(entries: Entry[], f: Filter): Entry[] {
  return entries.filter(
    (e) =>
      (f.source === "all" || (f.source === "rule") === !!e.ruleId) &&
      (!f.categoryId || e.categoryId === f.categoryId),
  );
}

// upcoming are the entries dated after today; the rest are history.
export function splitUpcoming(entries: Entry[], from: string = today()): { upcoming: Entry[]; past: Entry[] } {
  const upcoming: Entry[] = [];
  const past: Entry[] = [];
  for (const e of entries) (e.date > from ? upcoming : past).push(e);
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return { upcoming, past };
}

// counted tells an entry that adds to a total: a skipped one doesn't.
export const counted = (e: Entry) => e.status !== "skipped";

export interface DayGroup {
  date: string;
  total: number;
  entries: Entry[];
}

export interface MonthGroup {
  key: string; // YYYY-MM
  total: number;
  count: number;
  days: DayGroup[];
}

// byMonth groups entries newest first: months, then days, then the latest
// entered first within a day.
export function byMonth(entries: Entry[]): MonthGroup[] {
  const sorted = [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
  const months: MonthGroup[] = [];
  for (const e of sorted) {
    const key = e.date.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.key !== key) months.push((m = { key, total: 0, count: 0, days: [] }));
    let d = m.days[m.days.length - 1];
    if (!d || d.date !== e.date) m.days.push((d = { date: e.date, total: 0, entries: [] }));
    d.entries.push(e);
    if (counted(e)) {
      d.total += e.amount;
      m.total += e.amount;
      m.count++;
    }
  }
  return months;
}

export interface Recent {
  description: string;
  amount: number;
  categoryId?: string;
  priority: Priority;
}

// recents are the latest distinct descriptions entered by hand, for the
// new-entry sheet to offer.
export function recents(entries: Entry[], n = 6): Recent[] {
  const seen = new Set<string>();
  const out: Recent[] = [];
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  for (const e of sorted) {
    const key = e.description.trim().toLowerCase();
    if (!key || e.ruleId || seen.has(key)) continue;
    seen.add(key);
    out.push({ description: e.description, amount: e.amount, categoryId: e.categoryId, priority: e.priority });
    if (out.length === n) break;
  }
  return out;
}

// usualPriority is the priority most entries in each category carry, so a
// category picked for a new entry brings its usual priority along.
export function usualPriority(entries: Entry[]): Map<string, Priority> {
  const counts = new Map<string, Record<Priority, number>>();
  for (const e of entries) {
    if (!e.categoryId) continue;
    const c = counts.get(e.categoryId) ?? { need: 0, want: 0, savings: 0 };
    c[e.priority]++;
    counts.set(e.categoryId, c);
  }
  const out = new Map<string, Priority>();
  for (const [id, c] of counts) {
    out.set(id, (Object.keys(c) as Priority[]).reduce((a, b) => (c[b] > c[a] ? b : a)));
  }
  return out;
}

// The colors a category can take, the most distinct first. Green stays
// out: it means Need and income.
export const PALETTE = ["amber", "sky", "violet", "rose", "teal", "lime", "fuchsia", "blue", "orange", "yellow", "pink"] as const;
export type Hue = (typeof PALETTE)[number];

const isHue = (c?: string | null): c is Hue => !!c && (PALETTE as readonly string[]).includes(c.toLowerCase());

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// withHues gives each category a color of its own: a stored palette color
// stays; the others, in name order, take the color their name points to
// or the next one no other category has. Adding a category rarely moves
// another's color.
export function withHues<C extends Pick<Category, "id" | "name" | "color">>(categories: C[]): C[] {
  const taken = new Set<string>(categories.filter((c) => isHue(c.color)).map((c) => c.color!.toLowerCase()));
  const hues = new Map<string, Hue>();
  for (const c of [...categories].sort((a, b) => a.name.localeCompare(b.name))) {
    if (isHue(c.color)) continue;
    const start = hash(c.name.toLowerCase()) % PALETTE.length;
    let hue: Hue = PALETTE[start];
    for (let i = 0; i < PALETTE.length; i++) {
      const h = PALETTE[(start + i) % PALETTE.length];
      if (!taken.has(h)) {
        hue = h;
        break;
      }
    }
    taken.add(hue);
    hues.set(c.id, hue);
  }
  return categories.map((c) => (hues.has(c.id) ? { ...c, color: hues.get(c.id) } : c));
}

export function hueOf(category?: Pick<Category, "name" | "color">): Hue | undefined {
  if (!category) return undefined;
  if (isHue(category.color)) return category.color.toLowerCase() as Hue;
  return PALETTE[hash(category.name.toLowerCase()) % PALETTE.length];
}

// money formats an amount the way these pages show it: ₱1,300 or ₱85.50.
export function money(amount: number, currency = "PHP"): string {
  const symbol = { PHP: "₱", USD: "$", EUR: "€", JPY: "¥" }[currency] ?? `${currency} `;
  const whole = Number.isInteger(Math.round(amount * 100) / 100) && amount % 1 === 0;
  return (
    symbol +
    Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  );
}

// signed puts the sign of the kind in front: −₱85 for an expense, +₱500
// for an income.
export const signed = (kind: LedgerKind, amount: number, currency?: string) =>
  `${kind === "expense" ? "−" : "+"}${money(amount, currency)}`;
