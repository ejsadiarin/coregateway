import { describe, expect, it } from "vitest";
import { bellOf } from "./reminder-bell";
import type { KanbanReminder } from "@/types/kanban";

const now = new Date("2026-11-25T08:00:00Z");
const reminder = (over: Partial<KanbanReminder>): KanbanReminder => ({
  id: Math.random().toString(36).slice(2),
  message: "x",
  schedule: { kind: "once", at: "2026-11-25T18:00:00+08:00" },
  next_fire_at: "2026-11-25T10:00:00Z",
  paused: null,
  last_delivery: null,
  card: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});

describe("bellOf", () => {
  it("lists what's coming soonest first and counts what's due in the next day", () => {
    const later = reminder({ message: "later", next_fire_at: "2026-11-27T08:00:00Z" });
    const soon = reminder({ message: "soon", next_fire_at: "2026-11-25T09:00:00Z" });
    const tonight = reminder({ message: "tonight", next_fire_at: "2026-11-26T07:59:00Z" });
    const done = reminder({ message: "sent, nothing next", next_fire_at: null });
    const bell = bellOf([later, done, tonight, soon], now);
    expect(bell.upcoming.map((r) => r.message)).toEqual(["soon", "tonight", "later"]);
    expect(bell.dueSoon).toBe(2);
  });

  it("doesn't count a paused reminder as due, and says when none can be sent", () => {
    const paused = reminder({ paused: "card_completed", next_fire_at: "2026-11-25T09:00:00Z" });
    expect(bellOf([paused], now).dueSoon).toBe(0);

    const noTarget = reminder({ paused: "no_notification_target" });
    expect(bellOf([noTarget], now).noTarget).toBe(true);
    expect(bellOf([paused], now).noTarget).toBe(false);
  });

  it("shows at most the first few", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      reminder({ next_fire_at: new Date(now.getTime() + (i + 1) * 3600_000).toISOString() }),
    );
    expect(bellOf(many, now).upcoming).toHaveLength(6);
    expect(bellOf(many, now).more).toBe(3);
  });
});
