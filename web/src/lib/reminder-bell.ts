import type { KanbanReminder } from "@/types/kanban";

// The most reminders the bell lists before pointing to the Reminders page.
const SHOWN = 6;
const DAY = 24 * 60 * 60 * 1000;

export interface Bell {
  // Reminders with a next send, soonest first, at most SHOWN of them.
  upcoming: KanbanReminder[];
  // How many more have a next send beyond those shown.
  more: number;
  // Reminders that will actually go out within the next day: the badge.
  dueSoon: number;
  // A reminder is held back for want of a notification target, so none
  // can be sent until one is set.
  noTarget: boolean;
}

// bellOf is what the header's bell shows of the owner's reminders at now.
export function bellOf(reminders: KanbanReminder[], now: Date): Bell {
  const next = reminders
    .filter((r) => r.next_fire_at)
    .sort((a, b) => Date.parse(a.next_fire_at!) - Date.parse(b.next_fire_at!));
  const until = now.getTime() + DAY;
  return {
    upcoming: next.slice(0, SHOWN),
    more: Math.max(0, next.length - SHOWN),
    dueSoon: next.filter((r) => !r.paused && Date.parse(r.next_fire_at!) <= until).length,
    noTarget: reminders.some((r) => r.paused === "no_notification_target"),
  };
}
