import { describe, it, expect } from "vitest";
import { describeSchedule, groupReminders, reminderNote, fieldsOf, formatDue, scheduleOf, formatWall, isOverdue, reminderEdit, reminderStatus, toInputValue, zoneLabel } from "@/lib/kanban-schedule";
import type { KanbanReminder, KanbanSchedule } from "@/types/kanban";

// coreban renders reminder times in the owner's timezone, so the wall
// time is read straight from the string, whatever zone this device is in.
describe("formatWall", () => {
  it("shows the owner's wall time with its weekday", () => {
    expect(formatWall("2026-11-10T07:00:00+08:00", 2026)).toBe("Tue 10 Nov, 7:00 AM");
    expect(formatWall("2026-11-10T23:30:00-05:00", 2026)).toBe("Tue 10 Nov, 11:30 PM");
  });

  it("adds the year when it is not the current one", () => {
    expect(formatWall("2027-01-01T00:05:00Z", 2026)).toBe("Fri 1 Jan 2027, 12:05 AM");
  });
});

describe("toInputValue", () => {
  it("gives a datetime-local value in the owner's zone", () => {
    expect(toInputValue("2026-11-10T07:00:00+08:00")).toBe("2026-11-10T07:00");
  });
});

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

describe("reminderStatus", () => {
  const at = "2026-11-10T07:00:00+08:00";

  it("says when a pending reminder fires next", () => {
    expect(reminderStatus(reminder({ next_fire_at: at }), 2026)).toEqual({ tone: "pending", text: "Next: Tue 10 Nov, 7:00 AM" });
  });

  it("says a pending reminder is held without a notification target", () => {
    expect(reminderStatus(reminder({ next_fire_at: at, paused: "no_notification_target" }), 2026)).toEqual({
      tone: "warning",
      text: "Set for Tue 10 Nov, 7:00 AM · not sent until you set a notification target",
    });
  });

  it("says a reminder is quiet while its card is completed or archived", () => {
    expect(reminderStatus(reminder({ next_fire_at: at, paused: "card_completed" }), 2026)).toEqual({
      tone: "pending",
      text: "Set for Tue 10 Nov, 7:00 AM · quiet while its card is Done",
    });
    expect(reminderStatus(reminder({ next_fire_at: at, paused: "card_archived" }), 2026)).toEqual({
      tone: "pending",
      text: "Set for Tue 10 Nov, 7:00 AM · quiet while its card is archived",
    });
  });

  it("reports the last delivery once nothing is left to send", () => {
    expect(reminderStatus(reminder({ last_delivery: { at, late: false, error: null } }), 2026)).toEqual({
      tone: "done",
      text: "Sent Tue 10 Nov, 7:00 AM",
    });
    expect(reminderStatus(reminder({ last_delivery: { at, late: true, error: null } }), 2026)).toEqual({
      tone: "done",
      text: "Sent late, Tue 10 Nov, 7:00 AM",
    });
  });

  it("reports a failed send with ntfy's reason", () => {
    expect(
      reminderStatus(reminder({ last_delivery: { at, late: false, error: "ntfy answered 403 Forbidden" } }), 2026),
    ).toEqual({ tone: "error", text: "Couldn't send Tue 10 Nov, 7:00 AM: ntfy answered 403 Forbidden" });
  });
});

describe("zoneLabel", () => {
  it("reads an IANA zone with spaces", () => {
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos Aires");
  });
});

describe("formatDue", () => {
  it("shows a date due without a time", () => {
    expect(formatDue({ date: "2026-11-14" }, 2026)).toBe("Sat 14 Nov");
    expect(formatDue({ date: "2027-01-01" }, 2026)).toBe("Fri 1 Jan 2027");
  });

  it("shows a moment due with its time in the owner's zone", () => {
    expect(formatDue({ at: "2026-11-14T17:00:00+08:00" }, 2026)).toBe("Sat 14 Nov, 5:00 PM");
  });
});

describe("isOverdue", () => {
  // 2026-11-14T16:30 in Manila (+08:00).
  const now = new Date("2026-11-14T08:30:00Z");

  it("compares a moment due with now", () => {
    expect(isOverdue({ at: "2026-11-14T17:00:00+08:00" }, now, "Asia/Manila")).toBe(false);
    expect(isOverdue({ at: "2026-11-14T16:00:00+08:00" }, now, "Asia/Manila")).toBe(true);
  });

  it("counts a date due as overdue only once that day has passed in the owner's zone", () => {
    expect(isOverdue({ date: "2026-11-14" }, now, "Asia/Manila")).toBe(false);
    expect(isOverdue({ date: "2026-11-13" }, now, "Asia/Manila")).toBe(true);
    // Still the 13th in New York.
    expect(isOverdue({ date: "2026-11-13" }, new Date("2026-11-14T02:00:00Z"), "America/New_York")).toBe(false);
  });
});

describe("describeSchedule", () => {
  it("names each preset with its time of day", () => {
    expect(describeSchedule({ kind: "once", at: "2026-11-10T07:00:00+08:00" })).toBe("Once");
    expect(describeSchedule({ kind: "daily", time: "07:00" })).toBe("Daily at 7:00 AM");
    expect(describeSchedule({ kind: "weekly", time: "19:30", weekdays: ["MO", "WE", "FR"] })).toBe(
      "Mon, Wed, Fri at 7:30 PM",
    );
    expect(describeSchedule({ kind: "every", time: "08:00", days: 3, from: "2026-11-10" })).toBe(
      "Every 3 days at 8:00 AM",
    );
    expect(describeSchedule({ kind: "every", time: "08:00", days: 1, from: "2026-11-10" })).toBe("Every day at 8:00 AM");
  });
});

describe("schedule fields", () => {
  it("round-trips each preset through the form", () => {
    const schedules: KanbanSchedule[] = [
      { kind: "once", at: "2026-11-10T07:00:00+08:00" },
      { kind: "daily", time: "07:00" },
      { kind: "weekly", time: "19:30", weekdays: ["MO", "FR"] },
      { kind: "every", time: "08:00", days: 3, from: "2026-11-10" },
    ];
    expect(schedules.map((s) => scheduleOf(fieldsOf(s)))).toEqual([
      { schedule: { kind: "once", at: "2026-11-10T07:00" } },
      { schedule: { kind: "daily", time: "07:00" } },
      { schedule: { kind: "weekly", time: "19:30", weekdays: ["MO", "FR"] } },
      { schedule: { kind: "every", time: "08:00", days: 3, from: "2026-11-10" } },
    ]);
  });

  it("starts a new reminder as a one-off with a 07:00 default for recurring", () => {
    expect(fieldsOf()).toMatchObject({ kind: "once", at: "", time: "07:00", weekdays: [] });
  });

  it("says which field is missing", () => {
    const blank = fieldsOf();
    expect(scheduleOf(blank)).toEqual({ field: "at", error: "Choose when it should reach you." });
    expect(scheduleOf({ ...blank, kind: "daily", time: "" })).toEqual({ field: "time", error: "Choose a time of day." });
    expect(scheduleOf({ ...blank, kind: "weekly" })).toEqual({ field: "weekdays", error: "Pick at least one day." });
    expect(scheduleOf({ ...blank, kind: "every", days: "0" })).toEqual({
      field: "days",
      error: "Repeat every 1 to 365 days.",
    });
  });

  it("keeps weekdays in week order and leaves an empty start date to coreban", () => {
    expect(scheduleOf({ ...fieldsOf(), kind: "weekly", weekdays: ["FR", "MO"] })).toEqual({
      schedule: { kind: "weekly", time: "07:00", weekdays: ["MO", "FR"] },
    });
    expect(scheduleOf({ ...fieldsOf(), kind: "every", days: "2", from: "" })).toEqual({
      schedule: { kind: "every", time: "07:00", days: 2 },
    });
  });
});

describe("reminderEdit", () => {
  const daily: KanbanSchedule = { kind: "daily", time: "07:00" };

  it("leaves an unchanged schedule out, so saving a new message doesn't re-arm the reminder", () => {
    expect(reminderEdit(daily, "new words", { kind: "daily", time: "07:00" })).toEqual({ message: "new words" });
  });

  it("sends a changed schedule", () => {
    expect(reminderEdit(daily, "m", { kind: "daily", time: "08:00" })).toEqual({
      message: "m",
      schedule: { kind: "daily", time: "08:00" },
    });
  });
});

describe("groupReminders", () => {
  const tz = "Asia/Manila";
  // 26 Nov, 10:00 in Manila.
  const now = new Date("2026-11-26T02:00:00Z");
  const next = (id: string, at: string, over: Partial<KanbanReminder> = {}) =>
    reminder({ id, next_fire_at: at, ...over });
  const shape = (rs: KanbanReminder[], at = now) =>
    groupReminders(rs, at, tz).map((g) => [g.key, g.reminders.map((r) => r.id)]);

  it("sorts what is coming into today, tomorrow, this week, and later, soonest first", () => {
    expect(
      shape([
        next("later", "2026-12-03T09:00:00+08:00"),
        next("today-late", "2026-11-26T22:00:00+08:00"),
        next("today", "2026-11-26T15:00:00+08:00"),
        next("tomorrow", "2026-11-27T00:30:00+08:00"),
        next("week", "2026-12-02T23:00:00+08:00"),
      ]),
    ).toEqual([
      ["today", ["today", "today-late"]],
      ["tomorrow", ["tomorrow"]],
      ["week", ["week"]],
      ["later", ["later"]],
    ]);
  });

  it("reads today in the owner's timezone, not UTC", () => {
    const r = next("r", "2026-11-27T00:30:00+08:00");
    // 23:59 on the 26th in Manila, but already the 26th 15:59 UTC.
    expect(shape([r], new Date("2026-11-26T15:59:00Z"))).toEqual([["tomorrow", ["r"]]]);
    // 00:01 on the 27th in Manila, still the 26th in UTC.
    expect(shape([r], new Date("2026-11-26T16:01:00Z"))).toEqual([["today", ["r"]]]);
  });

  it("puts a send that is overdue, or a one-off that couldn't be sent, under late", () => {
    expect(
      shape([
        next("paused", "2026-11-25T09:00:00+08:00", { paused: "no_notification_target" }),
        reminder({ id: "failed", last_delivery: { at: "2026-11-24T09:00:00+08:00", late: false, error: "ntfy 500" } }),
      ]),
    ).toEqual([["late", ["failed", "paused"]]]);
  });

  it("puts a recurring reminder whose last send failed under late, until a send goes through", () => {
    const failed = { at: "2026-11-25T19:00:00+08:00", late: false, error: "ntfy 500" };
    const daily = { kind: "daily", time: "19:00" } as const;
    expect(
      shape([
        next("broken", "2026-11-26T19:00:00+08:00", { schedule: daily, last_delivery: failed }),
        next("fine", "2026-11-26T19:00:00+08:00", { schedule: daily, last_delivery: { ...failed, error: null } }),
      ]),
    ).toEqual([
      ["late", ["broken"]],
      ["today", ["fine"]],
    ]);
  });

  it("folds what has nothing left to send under sent, latest first", () => {
    expect(
      shape([
        reminder({ id: "old", last_delivery: { at: "2026-11-20T09:00:00+08:00", late: false, error: null } }),
        reminder({ id: "never" }),
        reminder({ id: "new", last_delivery: { at: "2026-11-25T09:00:00+08:00", late: true, error: null } }),
      ]),
    ).toEqual([["sent", ["new", "old", "never"]]]);
  });

  it("leaves out empty groups and keeps a recurring reminder by its next send", () => {
    const daily = next("daily", "2026-11-26T19:00:00+08:00", { schedule: { kind: "daily", time: "19:00" } });
    expect(groupReminders([daily], now, tz)).toEqual([{ key: "today", title: "Today", reminders: [daily] }]);
  });
});

// A row already leads with the reminder's time, so its note never repeats it.
describe("reminderNote", () => {
  const at = "2026-11-10T07:00:00+08:00";

  it("says nothing more about a reminder that will simply be sent", () => {
    expect(reminderNote(reminder({ next_fire_at: at }))).toBeNull();
  });

  it("says a recurring reminder's last send failed, ahead of any pause", () => {
    const last_delivery = { at, late: false, error: "ntfy 403" };
    expect(reminderNote(reminder({ next_fire_at: at, last_delivery }))).toEqual({ tone: "error", text: "Couldn't send: ntfy 403" });
    expect(reminderNote(reminder({ next_fire_at: at, paused: "card_completed", last_delivery }))?.tone).toBe("error");
  });

  it("says why a pending reminder won't be sent", () => {
    expect(reminderNote(reminder({ next_fire_at: at, paused: "no_notification_target" }))).toEqual({
      tone: "warning",
      text: "Not sent until you set a notification target",
    });
    expect(reminderNote(reminder({ next_fire_at: at, paused: "card_completed" }))?.text).toBe("Quiet while its card is Done");
    expect(reminderNote(reminder({ next_fire_at: at, paused: "card_archived" }))?.text).toBe(
      "Quiet while its card is archived",
    );
  });

  it("says how the last send went once nothing is left to send", () => {
    expect(reminderNote(reminder({ last_delivery: { at, late: false, error: null } }))).toEqual({ tone: "done", text: "Sent" });
    expect(reminderNote(reminder({ last_delivery: { at, late: true, error: null } }))?.text).toBe("Sent late");
    expect(reminderNote(reminder({ last_delivery: { at, late: false, error: "ntfy 403" } }))).toEqual({
      tone: "error",
      text: "Couldn't send: ntfy 403",
    });
    expect(reminderNote(reminder({}))).toEqual({ tone: "done", text: "Nothing left to send" });
  });
});
