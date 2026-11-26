import { addDays, deliveryNote, pausedNote, toInputValue, type ReminderStatus } from "@/lib/kanban-schedule";
import type { KanbanReminder, KanbanWeekday } from "@/types/kanban";

// An occurrence is one moment a reminder's schedule fires, as the calendar
// shows it: at is the owner's wall time (YYYY-MM-DDTHH:MM), and sent marks
// the one past send coreban keeps (last_delivery). Only the next send is
// stored; the ones after it are worked out from the schedule.
export interface Occurrence {
  reminder: KanbanReminder;
  at: string;
  sent: boolean;
}

const weekdayCodes: KanbanWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const dayDiff = (a: string, b: string) => Math.round((utc(a) - utc(b)) / 86_400_000);
const weekdayOf = (date: string) => weekdayCodes[new Date(utc(date)).getUTCDay()];

// shiftMonth moves a YYYY-MM month by n months.
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// monthGrid lays a YYYY-MM month out Monday first, its dates padded with
// nulls to whole weeks.
export function monthGrid(month: string): (string | null)[] {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const lead = (new Date(utc(first)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = first; day <= last; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// fallsOn says a recurring schedule fires on date.
function fallsOn(r: KanbanReminder, date: string): boolean {
  const s = r.schedule;
  switch (s.kind) {
    case "once":
      return false;
    case "daily":
      return true;
    case "weekly":
      return s.weekdays.includes(weekdayOf(date));
    case "every":
      return dayDiff(date, s.from) % s.days === 0;
  }
}

// occurrencesInMonth maps each day of a YYYY-MM month to the occurrences on
// it, by time: each reminder's next send and, for a recurring one, every
// matching day after it, plus its last send if it fell in the month.
export function occurrencesInMonth(reminders: KanbanReminder[], month: string): Map<string, Occurrence[]> {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const byDay = new Map<string, Occurrence[]>();
  const add = (o: Occurrence) => {
    const day = o.at.slice(0, 10);
    if (day < first || day > last) return;
    byDay.set(day, [...(byDay.get(day) ?? []), o]);
  };

  for (const r of reminders) {
    if (r.last_delivery) add({ reminder: r, at: toInputValue(r.last_delivery.at), sent: true });
    if (!r.next_fire_at) continue;
    const next = toInputValue(r.next_fire_at);
    add({ reminder: r, at: next, sent: false });
    if (r.schedule.kind === "once") continue;
    const time = r.schedule.time;
    const start = next.slice(0, 10) < first ? addDays(first, -1) : next.slice(0, 10);
    for (let day = addDays(start, 1); day <= last; day = addDays(day, 1)) {
      if (fallsOn(r, day)) add({ reminder: r, at: `${day}T${time}`, sent: false });
    }
  }

  return new Map(
    [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, os]) => [day, os.sort((a, b) => (a.at < b.at ? -1 : 1))]),
  );
}

// occurrenceNote is what an occurrence's row adds beyond its time: how a
// past send went, or why a coming one won't go out.
export function occurrenceNote(o: Occurrence): ReminderStatus | null {
  if (o.sent && o.reminder.last_delivery) return deliveryNote(o.reminder.last_delivery);
  return pausedNote(o.reminder);
}
