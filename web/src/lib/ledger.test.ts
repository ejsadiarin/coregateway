import { describe, expect, it } from "vitest";
import {
  applyFilter,
  byMonth,
  cadencePhrase,
  dueDatesWithin,
  canSkip,
  cleanNotes,
  ended,
  entryOf,
  hueOf,
  money,
  nextDue,
  recents,
  ruleLabel,
  ruleTotals,
  signed,
  skipStatus,
  splitUpcoming,
  usualPriority,
  withHues,
  type Entry,
  type Rule,
} from "./ledger";

const entry = (over: Partial<Entry>): Entry => ({
  id: Math.random().toString(36).slice(2),
  kind: "expense",
  description: "x",
  amount: 1,
  currency: "PHP",
  date: "2026-11-01",
  notes: "",
  priority: "want",
  status: "posted",
  createdAt: "2026-11-01T10:00:00Z",
  ...over,
});

const rule = (over: Partial<Rule>): Rule => ({
  id: "r",
  kind: "expense",
  description: "spotify",
  amount: 85,
  currency: "PHP",
  cadence: "monthly",
  startDate: "2026-02-23",
  notes: "",
  priority: "need",
  active: true,
  ...over,
});

describe("cleanNotes", () => {
  it("hides the backfill marker and its dump line", () => {
    expect(cleanNotes("[backfill:messenger-2026-11] student plan")).toBe("student plan");
    expect(cleanNotes("[backfill:messenger-2026-11] dump L846")).toBe("");
    expect(cleanNotes(undefined)).toBe("");
    expect(cleanNotes("plain note")).toBe("plain note");
  });
});

describe("entryOf", () => {
  it("maps the fixed conversion fields", () => {
    const e = entryOf("expense", {
      id: "e1",
      description: "gift",
      amount: 100,
      currency: "USD",
      exchange_rate: "61.573",
      amount_php: "6157.3",
      rate_date: "2026-07-10T00:00:00Z",
      expense_date: "2026-07-12",
      priority: "want",
      status: "posted",
      is_debt: false,
      created_at: "2026-07-12T10:00:00Z",
      updated_at: "2026-07-12T10:00:00Z",
    });
    expect(e.conversion?.exchangeRate).toBe(61.573);
    expect(e.conversion?.amountPHP).toBe(6157.3);
    expect(e.conversion?.rateDate).toBe("2026-07-10");
  });

  it("leaves a PHP response without conversion fields undefined", () => {
    const e = entryOf("income", {
      id: "i1",
      amount: 500,
      currency: "PHP",
      exchange_rate: "1",
      amount_php: "500",
      rate_date: "2026-11-01T00:00:00Z",
      date: "2026-11-01",
      description: "pay",
      priority: "need",
      status: "posted",
      created_at: "2026-11-01T10:00:00Z",
      updated_at: "2026-11-01T10:00:00Z",
    });
    expect(e.conversion).toBeUndefined();
  });
});

describe("nextDue", () => {
  it("is the rule's next date on or after today it hasn't made yet", () => {
    expect(nextDue(rule({}), new Set(), "2026-11-14")).toBe("2026-11-23");
    expect(nextDue(rule({}), new Set(["2026-11-23"]), "2026-11-14")).toBe("2026-12-23");
    expect(nextDue(rule({}), new Set(), "2026-11-23")).toBe("2026-11-23");
  });

  it("keeps a monthly rule's day and falls on a short month's last day", () => {
    const r = rule({ startDate: "2026-01-31" });
    expect(nextDue(r, new Set(), "2026-02-01")).toBe("2026-02-28");
    expect(nextDue(r, new Set(), "2026-03-01")).toBe("2026-03-31");
  });

  it("steps weekly and yearly", () => {
    expect(nextDue(rule({ cadence: "weekly", startDate: "2026-11-19" }), new Set(["2026-11-19"]), "2026-11-14")).toBe("2026-11-26");
    expect(nextDue(rule({ cadence: "yearly", startDate: "2025-09-22" }), new Set(), "2026-11-14")).toBe("2027-09-22");
  });

  it("has none for a paused or ended rule", () => {
    expect(nextDue(rule({ active: false }), new Set(), "2026-11-14")).toBeUndefined();
    expect(nextDue(rule({ endDate: "2026-11-20" }), new Set(), "2026-11-14")).toBeUndefined();
    expect(ended(rule({ endDate: "2026-11-13" }), "2026-11-14")).toBe(true);
    expect(ended(rule({ endDate: "2026-11-14" }), "2026-11-14")).toBe(false);
  });
});

describe("cadencePhrase", () => {
  it("says when a rule repeats", () => {
    expect(cadencePhrase("weekly", "2026-11-19")).toBe("every Thursday");
    expect(cadencePhrase("monthly", "2026-02-23")).toBe("on the 23rd of every month");
    expect(cadencePhrase("monthly", "2026-02-11")).toBe("on the 11th of every month");
    expect(cadencePhrase("yearly", "2025-09-22")).toBe("every Sep 22");
  });
});

describe("ruleTotals", () => {
  it("adds monthly-ish rules per month and yearly ones per year", () => {
    expect(ruleTotals([rule({ amount: 85 }), rule({ amount: 1300 }), rule({ cadence: "yearly", amount: 759 })])).toEqual({
      perMonth: 1385,
      perYear: 759,
    });
  });
});

describe("filters and groups", () => {
  const made = entry({ ruleId: "r", categoryId: "subs", date: "2026-10-23" });
  const hand = entry({ categoryId: "food", date: "2026-11-13", amount: 160 });
  const hand2 = entry({ categoryId: "food", date: "2026-11-13", amount: 40, createdAt: "2026-11-13T12:00:00Z" });
  const skipped = entry({ date: "2026-11-12", status: "skipped", amount: 999 });
  const ahead = entry({ date: "2026-12-15", status: "pending" });

  it("filters by who made an entry and by category", () => {
    expect(applyFilter([made, hand], { source: "rule" })).toEqual([made]);
    expect(applyFilter([made, hand], { source: "hand" })).toEqual([hand]);
    expect(applyFilter([made, hand], { source: "all", categoryId: "subs" })).toEqual([made]);
  });

  it("holds entries dated after today apart, soonest first", () => {
    const { upcoming, past } = splitUpcoming([ahead, hand, entry({ date: "2026-11-20" })], "2026-11-14");
    expect(upcoming.map((e) => e.date)).toEqual(["2026-11-20", "2026-12-15"]);
    expect(past).toEqual([hand]);
  });

  it("groups newest first by month and day, leaving skipped entries out of the totals", () => {
    const months = byMonth([made, hand, skipped, hand2]);
    expect(months.map((m) => [m.key, m.total, m.count])).toEqual([
      ["2026-11", 200, 2],
      ["2026-10", 1, 1],
    ]);
    expect(months[0].days.map((d) => [d.date, d.total])).toEqual([
      ["2026-11-13", 200],
      ["2026-11-12", 0],
    ]);
    expect(months[0].days[0].entries[0]).toBe(hand2);
  });

  it("offers the latest distinct hand-made descriptions", () => {
    const r = recents([
      entry({ description: "bus", date: "2026-11-10" }),
      entry({ description: "Bus", date: "2026-11-12" }),
      entry({ description: "spotify", ruleId: "r", date: "2026-11-13" }),
      entry({ description: "dinner", date: "2026-11-11" }),
    ]);
    expect(r.map((x) => x.description)).toEqual(["Bus", "dinner"]);
  });

  it("knows each category's usual priority", () => {
    const m = usualPriority([
      entry({ categoryId: "t", priority: "need" }),
      entry({ categoryId: "t", priority: "need" }),
      entry({ categoryId: "t", priority: "want" }),
    ]);
    expect(m.get("t")).toBe("need");
  });
});

describe("colors and money", () => {
  it("keeps a stored palette color and gives any other category a steady one", () => {
    expect(hueOf({ name: "Food", color: "sky" })).toBe("sky");
    expect(hueOf({ name: "Food", color: "#123456" })).toBe(hueOf({ name: "food" }));
    expect(hueOf(undefined)).toBeUndefined();
  });

  it("gives each category its own color and keeps a stored one", () => {
    const names = ["food", "transportation", "bills & installments", "subscriptions", "shopping", "entertainment"];
    const cats = withHues(names.map((name, i) => ({ id: String(i), name, color: undefined as string | undefined })));
    expect(new Set(cats.map((c) => c.color)).size).toBe(names.length);
    const again = withHues([...names, "gifts"].map((name, i) => ({ id: String(i), name, color: undefined as string | undefined })));
    expect(again.slice(0, names.length).filter((c, i) => c.color !== cats[i].color).length).toBeLessThanOrEqual(1);
    expect(withHues([{ id: "a", name: "x", color: "teal" }])[0].color).toBe("teal");
  });

  it("formats amounts", () => {
    expect(money(1300)).toBe("₱1,300");
    expect(money(85.5)).toBe("₱85.50");
    expect(signed("expense", 85)).toBe("−₱85");
    expect(signed("income", 500, "USD")).toBe("+$500");
  });
});

describe("ruleLabel", () => {
  it("names the rule that made an entry", () => {
    const rules = new Map([["r1", { description: "Spotify subscription" }]]);
    expect(ruleLabel("r1", rules)).toBe("Spotify subscription");
  });

  it("says just rule when the rule is gone", () => {
    expect(ruleLabel("deleted", new Map())).toBe("rule");
  });
});

describe("skipping one date", () => {
  it("is offered for rule entries only", () => {
    expect(canSkip({ source_rule_id: "r1" })).toBe(true);
    expect(canSkip({ source_rule_id: undefined })).toBe(false);
    expect(canSkip({})).toBe(false);
  });

  it("skips a posted or pending entry, and undoing lets its date decide", () => {
    expect(skipStatus("posted")).toBe("skipped");
    expect(skipStatus("pending")).toBe("skipped");
    expect(skipStatus(undefined)).toBe("skipped");
    expect(skipStatus("skipped")).toBeUndefined();
  });
});


describe("dueDatesWithin", () => {
  it("lists every date a rule falls on in a window that it hasn't made yet", () => {
    const daily = rule({ id: "d", cadence: "daily", startDate: "2026-11-01" });
    const made = new Set(["2026-11-15"]);
    expect(dueDatesWithin(daily, made, "2026-11-15", "2026-11-18")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("stops at the rule's end and finds none for a paused rule", () => {
    const weekly = rule({ id: "w", cadence: "weekly", startDate: "2026-11-02", endDate: "2026-11-16" });
    expect(dueDatesWithin(weekly, new Set(), "2026-11-01", "2026-11-30")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(dueDatesWithin(rule({ id: "p", cadence: "daily", startDate: "2026-11-01", active: false }), new Set(), "2026-11-15", "2026-11-21")).toEqual([]);
  });
});
