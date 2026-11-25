import { describe, expect, it } from "vitest";
import {
  budgetDateFrom,
  budgetPeriodBounds,
  budgetPeriodFrom,
  budgetPeriodTitle,
  previousBudgetPeriod,
  stepBudgetDate,
  todayISODate,
} from "./budget-period";

describe("budget period URL state", () => {
  it("falls back to week and today for missing or bad values", () => {
    expect(budgetPeriodFrom(null)).toBe("week");
    expect(budgetPeriodFrom("year")).toBe("week");
    expect(budgetPeriodFrom("month")).toBe("month");
    expect(budgetDateFrom("2026-13-01")).toBe(todayISODate());
    expect(budgetDateFrom("2026-11-18")).toBe("2026-11-18");
  });
});

describe("budget period bounds", () => {
  it("keeps a day to itself", () => {
    expect(budgetPeriodBounds("day", "2026-11-18")).toEqual({
      start_date: "2026-11-18",
      end_date: "2026-11-18",
    });
  });

  it("runs weeks Monday to Sunday across a year", () => {
    expect(budgetPeriodBounds("week", "2026-12-31")).toEqual({
      start_date: "2026-12-28",
      end_date: "2027-01-03",
    });
  });

  it("runs months to their last day", () => {
    expect(budgetPeriodBounds("month", "2028-02-10")).toEqual({
      start_date: "2028-02-01",
      end_date: "2028-02-29",
    });
  });
});

describe("previous period bounds", () => {
  it("moves a day, a week and a month back", () => {
    expect(previousBudgetPeriod("day", "2026-11-18")).toEqual({
      start_date: "2026-11-17",
      end_date: "2026-11-17",
    });
    expect(previousBudgetPeriod("week", "2027-01-02")).toEqual({
      start_date: "2026-12-21",
      end_date: "2026-12-27",
    });
    expect(previousBudgetPeriod("month", "2026-01-15")).toEqual({
      start_date: "2025-12-01",
      end_date: "2025-12-31",
    });
  });
});

describe("stepping periods", () => {
  it("steps a day and a week", () => {
    expect(stepBudgetDate("day", "2026-11-18", 1)).toBe("2026-11-19");
    expect(stepBudgetDate("week", "2026-12-30", 1)).toBe("2027-01-06");
  });

  it("steps whole months instead of clamping the day", () => {
    expect(stepBudgetDate("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepBudgetDate("month", "2026-03-15", -1)).toBe("2026-02-01");
  });
});

describe("period titles", () => {
  it("names the range being viewed", () => {
    expect(budgetPeriodTitle("day", "2026-11-18", "2026-11-18")).toBe("Wed 18 Nov 2026");
    expect(budgetPeriodTitle("week", "2026-12-28", "2027-01-03")).toBe("28 Dec – 3 Jan 2027");
    expect(budgetPeriodTitle("month", "2026-11-01", "2026-11-30")).toBe("November 2026");
  });
});
