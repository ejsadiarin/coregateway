import { describe, expect, it } from "vitest";
import { totalsByCurrency } from "./format";
import type { Rule } from "./ledger";
import { dueAmounts, upcomingDues } from "./upcoming-bills";

const rule = (over: Partial<Rule>): Rule => ({
  id: "b1",
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

describe("upcomingDues", () => {
  it("finds a monthly rule that started months ago at its next due date", () => {
    const out = upcomingDues([rule({})], [], "2026-11-17", "2026-11-24");
    expect(out).toHaveLength(1);
    expect(out[0].dates).toEqual(["2026-11-23"]);
  });

  it("leaves a rule whose next due date is outside the window out", () => {
    expect(upcomingDues([rule({})], [], "2026-11-17", "2026-11-22")).toEqual([]);
  });

  it("returns every due date of a daily rule in the window", () => {
    const daily = rule({ cadence: "daily", startDate: "2026-11-01" });
    const out = upcomingDues([daily], [], "2026-11-17", "2026-11-19");
    expect(out[0].dates).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });

  it("skips a date that already has an entry for the rule", () => {
    const daily = rule({ cadence: "daily", startDate: "2026-11-01" });
    const out = upcomingDues([daily], [{ ruleId: "b1", date: "2026-11-17" }], "2026-11-17", "2026-11-19");
    expect(out[0].dates).toEqual(["2026-11-18", "2026-11-19"]);
  });

  it("leaves paused rules out and respects the end date", () => {
    const paused = rule({ active: false });
    const ended = rule({ id: "b2", cadence: "daily", startDate: "2026-11-01", endDate: "2026-11-18" });
    const out = upcomingDues([paused, ended], [], "2026-11-17", "2026-11-24");
    expect(out).toHaveLength(1);
    expect(out[0].dates).toEqual(["2026-11-17", "2026-11-18"]);
  });

});

describe("dueAmounts", () => {
  it("repeats a rule's amount for every due date in the window", () => {
    expect(
      dueAmounts([
        {
          ...rule({ amount: 100, currency: "USD" }),
          dates: ["2026-11-17", "2026-11-18", "2026-11-19"],
        },
      ]),
    ).toEqual([
      { amount: 100, currency: "USD" },
      { amount: 100, currency: "USD" },
      { amount: 100, currency: "USD" },
    ]);
  });

  it("multiplies the amount by the due dates in the total", () => {
    const due = [{ ...rule({ amount: 100, currency: "USD" }), dates: ["2026-11-17", "2026-11-18", "2026-11-19"] }];
    expect(totalsByCurrency(dueAmounts(due))).toEqual([{ currency: "USD", amount: 300 }]);
  });
});
