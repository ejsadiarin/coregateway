import type { KanbanDue, KanbanReminder } from "@/types/kanban";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// zoneLabel shows an IANA zone name readably ("Asia/Ho Chi Minh").
export const zoneLabel = (tz: string) => tz.replace(/_/g, " ");

// toInputValue is a datetime-local value for an RFC 3339 time coreban
// rendered in the owner's zone: its wall-clock part, unconverted.
export const toInputValue = (iso: string) => iso.slice(0, 16);

// formatWall shows an RFC 3339 time as the owner's wall clock, e.g.
// "Tue 10 Nov, 07:00", with the year added when it isn't currentYear. It
// reads the string's own date and time rather than converting it, since the
// owner's timezone need not be this device's.
export function formatWall(iso: string, currentYear: number): string {
  const [date, time] = toInputValue(iso).split("T");
  return `${formatDay(date, currentYear)}, ${time}`;
}

// formatDay shows a YYYY-MM-DD date as "Sat 14 Nov", with the year added
// when it isn't currentYear.
function formatDay(date: string, currentYear: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const year = y === currentYear ? "" : ` ${y}`;
  return `${weekday} ${d} ${months[m - 1]}${year}`;
}

// formatDue shows a card's due: "Sat 14 Nov" for a date, "Sat 14 Nov, 17:00"
// for a moment (in the owner's zone, as coreban renders it).
export function formatDue(due: KanbanDue, currentYear: number): string {
  return "at" in due ? formatWall(due.at, currentYear) : formatDay(due.date, currentYear);
}

// isOverdue says a due has passed: a moment once it is behind now, a date
// once that whole day is over in the owner's timezone.
export function isOverdue(due: KanbanDue, now: Date, timeZone: string): boolean {
  if ("at" in due) return Date.parse(due.at) < now.getTime();
  // en-CA formats as YYYY-MM-DD, which compares as a string.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return due.date < today;
}

export interface ReminderStatus {
  tone: "pending" | "warning" | "done" | "error";
  text: string;
}

// reminderStatus is the one line a reminder's row shows about it: when it
// fires next (and whether it can), or how its last send went.
export function reminderStatus(r: KanbanReminder, currentYear: number): ReminderStatus {
  const wall = (iso: string) => formatWall(iso, currentYear);
  if (r.next_fire_at) {
    return r.paused
      ? { tone: "warning", text: `Set for ${wall(r.next_fire_at)} · not sent until you set a notification target` }
      : { tone: "pending", text: `Next: ${wall(r.next_fire_at)}` };
  }
  const d = r.last_delivery;
  if (!d) return { tone: "done", text: "Nothing left to send" };
  if (d.error) return { tone: "error", text: `Couldn't send ${wall(d.at)}: ${d.error}` };
  return { tone: "done", text: `Sent${d.late ? " late," : ""} ${wall(d.at)}` };
}
