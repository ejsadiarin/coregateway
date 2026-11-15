import { describe, expect, it } from "vitest";
import { budgetChips, canSkip, skipStatus } from "./feed-rail";

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
