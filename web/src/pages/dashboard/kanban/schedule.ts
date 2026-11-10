import type { KanbanReminder } from "@/types/kanban";

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
  const [y, m, d] = date.split("-").map(Number);
  const weekday = weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const year = y === currentYear ? "" : ` ${y}`;
  return `${weekday} ${d} ${months[m - 1]}${year}, ${time}`;
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
