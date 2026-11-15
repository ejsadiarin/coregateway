import { describe, expect, it } from "vitest";
import { budgetChips, comingUp, monthDays, monthSummary, noteDaysFor, shortNet } from "./feed-rail";

describe("budgetChips", () => {
  const subs = { id: "c1", name: "subscriptions" };
  const work = { id: "t1", name: "work" };
  const ctx = {
    categoryById: new Map([["c1", subs]]),
    ruleById: new Map([["r1", { description: "Spotify subscription", cadence: "monthly" as const }]]),
    tagIds: new Map([["e1", ["t1", "gone"]]]),
    tagById: new Map([["t1", work]]),
  };

  it("shows a rule entry's category, rule with its cadence, and tags", () => {
    const chips = budgetChips({ id: "e1", category_id: "c1", source_rule_id: "r1", status: "posted" }, ctx);
    expect(chips).toEqual({ category: subs, rule: "Monthly · Spotify subscription", tags: [work], status: undefined });
  });

  it("names a removed rule just rule, and marks a skipped or pending record", () => {
    expect(budgetChips({ id: "e2", source_rule_id: "deleted", status: "skipped" }, ctx)).toEqual({
      category: undefined,
      rule: "rule",
      tags: [],
      status: "skipped",
    });
    expect(budgetChips({ id: "e3", status: "pending" }, ctx).status).toBe("pending");
  });
});

describe("monthDays", () => {
  const e = (date: string, kind: "expense" | "income", amount: number, status: "posted" | "skipped" = "posted") => ({
    date,
    kind,
    amount,
    status,
  });

  it("lays November 2026 out from Sunday, with each day's net and notes", () => {
    const cells = monthDays(
      "2026-11",
      [e("2026-11-05", "expense", 1300), e("2026-11-06", "income", 500), e("2026-11-06", "expense", 279), e("2026-11-07", "expense", 99, "skipped")],
      new Set(["2026-11-07", "2026-11-09"]),
      "2026-11-15",
    );
    // Nov 1 2026 is a Sunday: no blanks before it, 30 days.
    expect(cells).toHaveLength(30);
    expect(cells[4]).toEqual({ date: "2026-11-05", day: 5, net: -1300, dot: true, today: false, future: false });
    expect(cells[5]?.net).toBe(221);
    // A skipped entry doesn't count; a day with only notes still gets its dot.
    expect(cells[6]).toMatchObject({ net: undefined, dot: true });
    expect(cells[8]).toMatchObject({ net: undefined, dot: true });
    expect(cells[9]).toMatchObject({ dot: false });
    expect(cells[14]).toMatchObject({ today: true, future: false });
    expect(cells[15]).toMatchObject({ future: true });
  });

  it("counts posted records only, as the Feed's day heading does", () => {
    const cells = monthDays("2026-11", [e("2026-11-20", "expense", 85), { date: "2026-11-21", kind: "expense", amount: 85, status: "pending" }], new Set(), "2026-11-15");
    expect(cells[19]?.net).toBe(-85);
    expect(cells[20]).toMatchObject({ net: undefined, dot: false });
  });

  it("pads the first week with blanks", () => {
    // Oct 1 2026 is a Thursday.
    const cells = monthDays("2026-10", [], new Set(), "2026-11-15");
    expect(cells.slice(0, 4)).toEqual([null, null, null, null]);
    expect(cells[4]).toMatchObject({ date: "2026-10-01", day: 1 });
  });
});

describe("comingUp", () => {
  const now = new Date("2026-11-15T10:00:00");
  const reminder = (id: string, message: string, at: string | null, paused: string | null = null) => ({
    id,
    message,
    next_fire_at: at,
    paused,
  });

  it("lists the next seven days of reminders and rule entries, soonest first", () => {
    const items = comingUp(
      [
        reminder("r1", "pay internet bill", "2026-11-16T09:00:00"),
        reminder("r2", "dentist", "2026-11-30T09:00:00"),
        reminder("r3", "card is done", "2026-11-16T08:00:00", "card_completed"),
        reminder("r4", "no more", null),
      ],
      [
        { id: "s", kind: "expense", description: "spotify subscription", amount: 85, currency: "PHP", next: "2026-11-21" },
        { id: "w", kind: "expense", description: "a day too late", amount: 1, currency: "PHP", next: "2026-11-22" },
        { id: "b", kind: "income", description: "baon mom", amount: 500, currency: "PHP", next: "2026-11-17" },
        { id: "y", kind: "expense", description: "domain", amount: 700, currency: "PHP", next: "2026-12-01" },
        { id: "p", kind: "expense", description: "paused", amount: 1, currency: "PHP", next: undefined },
      ],
      now,
    );
    expect(items.map((i) => [i.date, i.kind, i.title])).toEqual([
      ["2026-11-16", "reminder", "pay internet bill"],
      ["2026-11-17", "rule", "baon mom"],
      ["2026-11-21", "rule", "spotify subscription"],
    ]);
    expect(items[0].time).toBe("09:00");
    expect(items[1]).toMatchObject({ ruleKind: "income", amount: 500 });
  });
});

describe("monthSummary", () => {
  it("says what was spent, received and is left, and how much of the income is gone", () => {
    expect(monthSummary({ total_income: 9500, total_expense: 6842, remaining: 2658 })).toEqual({
      spent: 6842,
      received: 9500,
      left: 2658,
      pct: 72,
    });
  });

  it("has no share when nothing came in, and caps it when spending passed income", () => {
    expect(monthSummary({ total_income: 0, total_expense: 300, remaining: -300 }).pct).toBeUndefined();
    expect(monthSummary({ total_income: 100, total_expense: 250, remaining: -150 }).pct).toBe(100);
  });
});

describe("shortNet", () => {
  it("fits a day's net in a calendar cell", () => {
    expect(shortNet(500)).toBe("+500");
    expect(shortNet(-85.5)).toBe("\u221286");
    expect(shortNet(-1300)).toBe("\u22121.3k");
    expect(shortNet(2000)).toBe("+2k");
    expect(shortNet(-12500)).toBe("\u221213k");
  });
});

describe("noteDaysFor", () => {
  const loaded = new Set(["2026-11-14", "2026-11-15"]);

  it("marks every day coreban lists, scrolled to or not", () => {
    expect(noteDaysFor(["2026-11-02", "2026-11-15"], loaded)).toEqual(new Set(["2026-11-02", "2026-11-15"]));
  });

  it("falls back to the days the Feed has loaded until coreban answers", () => {
    expect(noteDaysFor(undefined, loaded)).toBe(loaded);
  });
});
