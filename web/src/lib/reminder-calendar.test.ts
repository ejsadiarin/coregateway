import { describe, expect, it } from "vitest";
import { monthGrid, occurrenceNote, occurrencesInMonth, shiftMonth } from "@/lib/reminder-calendar";
import type { KanbanReminder } from "@/types/kanban";

function reminder(over: Partial<KanbanReminder>): KanbanReminder {
  return {
    id: "r",
    message: "m",
    schedule: { kind: "once", at: "2026-11-10T07:00:00+08:00" },
    next_fire_at: null,
    paused: null,
    last_delivery: null,
    card: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

// Days of the month an occurrence falls on, with its wall time.
const days = (rs: KanbanReminder[], month: string) =>
  [...occurrencesInMonth(rs, month)].map(([day, os]) => [day, os.map((o) => `${o.reminder.id}@${o.at.slice(11)}`)]);

describe("monthGrid", () => {
  it("lays a month out Monday first, padding both ends to whole weeks", () => {
    const grid = monthGrid("2026-11");
    // 1 Nov 2026 is a Sunday.
    expect(grid.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(grid.at(-1)).toBeNull();
    expect(grid.length % 7).toBe(0);
    expect(grid.filter(Boolean)).toHaveLength(30);
  });
});

describe("shiftMonth", () => {
  it("moves across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("occurrencesInMonth", () => {
  it("puts a one-off on its day, in the owner's wall time", () => {
    const r = reminder({ next_fire_at: "2026-11-26T22:00:00+08:00", schedule: { kind: "once", at: "2026-11-26T22:00:00+08:00" } });
    expect(days([r], "2026-11")).toEqual([["2026-11-26", ["r@22:00"]]]);
    expect(days([r], "2026-12")).toEqual([]);
  });

  it("repeats a daily reminder on every day from its next send", () => {
    const r = reminder({ next_fire_at: "2026-11-28T07:00:00+08:00", schedule: { kind: "daily", time: "07:00" } });
    expect(days([r], "2026-11")).toEqual([
      ["2026-11-28", ["r@07:00"]],
      ["2026-11-29", ["r@07:00"]],
      ["2026-11-30", ["r@07:00"]],
    ]);
    expect(days([r], "2026-12")).toHaveLength(31);
    expect(days([r], "2026-10")).toEqual([]);
  });

  it("repeats a weekly reminder on its weekdays only", () => {
    const r = reminder({
      next_fire_at: "2026-11-27T19:30:00+08:00",
      schedule: { kind: "weekly", time: "19:30", weekdays: ["MO", "FR"] },
    });
    expect(days([r], "2026-12").map(([d]) => d)).toEqual([
      "2026-12-04",
      "2026-12-07",
      "2026-12-11",
      "2026-12-14",
      "2026-12-18",
      "2026-12-21",
      "2026-12-25",
      "2026-12-28",
    ]);
  });

  it("repeats an every-N-days reminder counting from its start, across months", () => {
    const r = reminder({
      next_fire_at: "2026-11-29T08:00:00+08:00",
      schedule: { kind: "every", time: "08:00", days: 3, from: "2026-11-20" },
    });
    expect(days([r], "2026-11").map(([d]) => d)).toEqual(["2026-11-29"]);
    expect(days([r], "2026-12").map(([d]) => d)).toEqual([
      "2026-12-02",
      "2026-12-05",
      "2026-12-08",
      "2026-12-11",
      "2026-12-14",
      "2026-12-17",
      "2026-12-20",
      "2026-12-23",
      "2026-12-26",
      "2026-12-29",
    ]);
  });

  it("shows only the last send on past days, and nothing it never recorded", () => {
    const r = reminder({
      next_fire_at: "2026-11-27T07:00:00+08:00",
      schedule: { kind: "daily", time: "07:00" },
      last_delivery: { at: "2026-11-26T07:00:12+08:00", late: false, error: null },
    });
    const nov = occurrencesInMonth([r], "2026-11");
    expect(nov.get("2026-11-25")).toBeUndefined();
    expect(nov.get("2026-11-26")?.map((o) => [o.at, o.sent])).toEqual([["2026-11-26T07:00", true]]);
    expect(nov.get("2026-11-27")?.map((o) => o.sent)).toEqual([false]);
  });

  it("orders a day's occurrences by time", () => {
    const a = reminder({ id: "a", next_fire_at: "2026-11-26T22:00:00+08:00" });
    const b = reminder({ id: "b", next_fire_at: "2026-11-26T08:00:00+08:00" });
    expect(days([a, b], "2026-11")).toEqual([["2026-11-26", ["b@08:00", "a@22:00"]]]);
  });
});

describe("occurrenceNote", () => {
  const delivery = { at: "2026-11-26T07:00:00+08:00", late: true, error: null };

  it("says how a past send went, even for a reminder that repeats", () => {
    const r = reminder({ next_fire_at: "2026-11-27T07:00:00+08:00", schedule: { kind: "daily", time: "07:00" }, last_delivery: delivery });
    expect(occurrenceNote({ reminder: r, at: "2026-11-26T07:00", sent: true })?.text).toBe("Sent late");
    expect(occurrenceNote({ reminder: r, at: "2026-11-27T07:00", sent: false })).toBeNull();
  });

  it("says why a coming send won't go out", () => {
    const r = reminder({ next_fire_at: "2026-11-27T07:00:00+08:00", paused: "card_completed" });
    expect(occurrenceNote({ reminder: r, at: "2026-11-27T07:00", sent: false })?.text).toBe("Quiet while its card is Done");
  });
});
