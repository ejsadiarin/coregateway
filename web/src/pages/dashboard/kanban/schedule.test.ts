import { describe, it, expect } from "vitest";
import { formatWall, reminderStatus, toInputValue, zoneLabel } from "@/pages/dashboard/kanban/schedule";
import type { KanbanReminder } from "@/types/kanban";

// coreban renders reminder times in the owner's timezone, so the wall
// time is read straight from the string, whatever zone this device is in.
describe("formatWall", () => {
  it("shows the owner's wall time with its weekday", () => {
    expect(formatWall("2026-11-10T07:00:00+08:00", 2026)).toBe("Tue 10 Nov, 07:00");
    expect(formatWall("2026-11-10T23:30:00-05:00", 2026)).toBe("Tue 10 Nov, 23:30");
  });

  it("adds the year when it is not the current one", () => {
    expect(formatWall("2027-01-01T00:05:00Z", 2026)).toBe("Fri 1 Jan 2027, 00:05");
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
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("reminderStatus", () => {
  const at = "2026-11-10T07:00:00+08:00";

  it("says when a pending reminder fires next", () => {
    expect(reminderStatus(reminder({ next_fire_at: at }), 2026)).toEqual({ tone: "pending", text: "Next: Tue 10 Nov, 07:00" });
  });

  it("says a pending reminder is held without a notification target", () => {
    expect(reminderStatus(reminder({ next_fire_at: at, paused: "no_notification_target" }), 2026)).toEqual({
      tone: "warning",
      text: "Set for Tue 10 Nov, 07:00 · not sent until you set a notification target",
    });
  });

  it("reports the last delivery once nothing is left to send", () => {
    expect(reminderStatus(reminder({ last_delivery: { at, late: false, error: null } }), 2026)).toEqual({
      tone: "done",
      text: "Sent Tue 10 Nov, 07:00",
    });
    expect(reminderStatus(reminder({ last_delivery: { at, late: true, error: null } }), 2026)).toEqual({
      tone: "done",
      text: "Sent late, Tue 10 Nov, 07:00",
    });
  });

  it("reports a failed send with ntfy's reason", () => {
    expect(
      reminderStatus(reminder({ last_delivery: { at, late: false, error: "ntfy answered 403 Forbidden" } }), 2026),
    ).toEqual({ tone: "error", text: "Couldn't send Tue 10 Nov, 07:00: ntfy answered 403 Forbidden" });
  });
});

describe("zoneLabel", () => {
  it("reads an IANA zone with spaces", () => {
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos Aires");
  });
});
