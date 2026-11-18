import { describe, expect, it } from "vitest";
import { compareCategories, needsWantsSplit } from "./where-it-went";
import type { CategoryBreakdown } from "@/types/api";

const row = (id: string, name: string, amount: number): CategoryBreakdown => ({
  category_id: id,
  category_name: name,
  expense_count: 1,
  total_amount: amount,
});

describe("compareCategories", () => {
  it("shares spent, compares with the previous period and marks new categories", () => {
    const current = [row("food", "food", 300), row("travel", "travel", 100)];
    const previous = [row("food", "food", 100), row("transportation", "transportation", 50)];

    expect(compareCategories(current, previous)).toEqual([
      {
        category_id: "food",
        category_name: "food",
        category_color: undefined,
        amount: 300,
        share: 0.75,
        previous: 100,
        change: 200,
        direction: "up",
        isNew: false,
      },
      {
        category_id: "travel",
        category_name: "travel",
        category_color: undefined,
        amount: 100,
        share: 0.25,
        previous: 0,
        change: 100,
        direction: "up",
        isNew: true,
      },
    ]);
  });

  it("marks a smaller category as down and handles an empty period", () => {
    const changes = compareCategories([row("food", "food", 40)], [row("food", "food", 90)]);
    expect(changes[0].direction).toBe("down");
    expect(changes[0].change).toBe(-50);
    expect(compareCategories([], [row("food", "food", 90)])).toEqual([]);
  });

  it("leaves categories with no spending out", () => {
    expect(compareCategories([row("food", "food", 0), row("travel", "travel", 50)], [])).toHaveLength(1);
  });
});

describe("needsWantsSplit", () => {
  it("adds the priorities up and shares them of the total", () => {
    expect(needsWantsSplit(60, 30, 10)).toEqual({
      needs: 60,
      wants: 30,
      savings: 10,
      total: 100,
      needsShare: 0.6,
      wantsShare: 0.3,
    });
  });

  it("does not divide by zero", () => {
    expect(needsWantsSplit(0, 0, 0)).toMatchObject({ total: 0, needsShare: 0, wantsShare: 0 });
  });
});
