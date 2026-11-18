import { describe, expect, it } from "vitest";
import {
  calendarAvailable,
  calendarDays,
  noSpendDays,
  requiredDayBuckets,
  spendLevel,
} from "./spending-calendar";

describe("calendar window", () => {
  it("counts the days from the month start through today", () => {
    expect(requiredDayBuckets("2026-11-18", "2026-11-18")).toBe(18);
    expect(requiredDayBuckets("2026-11-01", "2026-11-18")).toBe(18);
    expect(requiredDayBuckets("2026-12-01", "2026-11-18")).toBe(0);
  });

  it("only reads a month inside the cash-flow bound", () => {
    expect(calendarAvailable(18)).toBe(true);
    expect(calendarAvailable(366)).toBe(true);
    expect(calendarAvailable(367)).toBe(false);
    expect(calendarAvailable(0)).toBe(false);
  });
});

describe("calendar grid", () => {
  const spent = new Map([
    ["2026-11-01", 0],
    ["2026-11-02", 120],
  ]);

  it("starts weeks on Monday and pads to whole weeks", () => {
    const days = calendarDays("2026-11-18", spent, "2026-11-18");
    expect(days.length % 7).toBe(0);
    // 1 November 2026 is a Sunday, so Monday's first cell is empty.
    expect(days[0]).toBeNull();
    expect(days[6]).toMatchObject({ date: "2026-11-01", spent: 0, noSpend: true });
  });

  it("leaves future days blank and counts no-spend days so far", () => {
    const days = calendarDays("2026-11-18", spent, "2026-11-18");
    const future = days.filter((day) => day?.future);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((day) => day?.spent === 0 && !day.noSpend)).toBe(true);
    expect(noSpendDays(days)).toBe(17);
  });

  it("marks only days with no spending as no-spend", () => {
    const days = calendarDays("2026-11-18", spent, "2026-11-02");
    const second = days.find((day) => day?.date === "2026-11-02");
    const first = days.find((day) => day?.date === "2026-11-01");
    expect(second).toMatchObject({ spent: 120, noSpend: false });
    expect(first).toMatchObject({ spent: 0, noSpend: true });
  });
});

describe("shading", () => {
  it("maps a day's share of the month's largest day to a level", () => {
    expect(spendLevel(0, 100)).toBe(0);
    expect(spendLevel(10, 100)).toBe(1);
    expect(spendLevel(40, 100)).toBe(2);
    expect(spendLevel(60, 100)).toBe(3);
    expect(spendLevel(100, 100)).toBe(4);
  });
});
