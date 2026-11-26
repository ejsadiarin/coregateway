import { clockLabel } from "@/lib/format";
import type {
  KanbanDue,
  KanbanReminder,
  KanbanReminderEdit,
  KanbanSchedule,
  KanbanScheduleInput,
  KanbanWeekday,
} from "@/types/kanban";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// zoneLabel shows an IANA zone name readably ("Asia/Ho Chi Minh").
export const zoneLabel = (tz: string) => tz.replace(/_/g, " ");

// toInputValue is a datetime-local value for an RFC 3339 time coreban
// rendered in the owner's zone: its wall-clock part, unconverted.
export const toInputValue = (iso: string) => iso.slice(0, 16);

// formatWall shows an RFC 3339 time as the owner's wall clock, e.g.
// "Tue 10 Nov, 7:00 AM", with the year added when it isn't currentYear. It
// reads the string's own date and time rather than converting it, since the
// owner's timezone need not be this device's.
export function formatWall(iso: string, currentYear: number): string {
  const [date, time] = toInputValue(iso).split("T");
  return `${formatDay(date, currentYear)}, ${clockLabel(time)}`;
}

// formatDay shows a YYYY-MM-DD date as "Sat 14 Nov", with the year added
// when it isn't currentYear.
export function formatDay(date: string, currentYear: number): string {
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

// todayIn is today's date (YYYY-MM-DD) in timeZone.
export function todayIn(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which compares as a string.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// addDays moves a YYYY-MM-DD date by n calendar days.
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// isOverdue says a due has passed: a moment once it is behind now, a date
// once that whole day is over in the owner's timezone.
export function isOverdue(due: KanbanDue, now: Date, timeZone: string): boolean {
  if ("at" in due) return Date.parse(due.at) < now.getTime();
  return due.date < todayIn(now, timeZone);
}

// weekdayNames name iCalendar day codes, in week order (Monday first).
export const weekdayNames: Record<KanbanWeekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

// describeSchedule names a reminder's schedule: "Once", "Daily at 07:00",
// "Mon, Wed, Fri at 19:30", "Every 3 days at 08:00".
export function describeSchedule(s: KanbanSchedule): string {
  switch (s.kind) {
    case "once":
      return "Once";
    case "daily":
      return `Daily at ${clockLabel(s.time)}`;
    case "weekly":
      return `${s.weekdays.map((d) => weekdayNames[d]).join(", ")} at ${clockLabel(s.time)}`;
    case "every":
      return `${s.days === 1 ? "Every day" : `Every ${s.days} days`} at ${clockLabel(s.time)}`;
  }
}

export interface ReminderStatus {
  tone: "pending" | "warning" | "done" | "error";
  text: string;
}

// pausedReason says why a pending reminder won't be sent when it comes.
const pausedReason: Record<NonNullable<KanbanReminder["paused"]>, ReminderStatus> = {
  no_notification_target: { tone: "warning", text: "not sent until you set a notification target" },
  card_completed: { tone: "pending", text: "quiet while its card is Done" },
  card_archived: { tone: "pending", text: "quiet while its card is archived" },
};

// reminderStatus is the one line a reminder's row shows about it: when it
// fires next (and whether it can), or how its last send went.
export function reminderStatus(r: KanbanReminder, currentYear: number): ReminderStatus {
  const wall = (iso: string) => formatWall(iso, currentYear);
  if (r.next_fire_at) {
    const at = wall(r.next_fire_at);
    if (r.paused) {
      const { tone, text } = pausedReason[r.paused];
      return { tone, text: `Set for ${at} · ${text}` };
    }
    return { tone: "pending", text: `Next: ${at}` };
  }
  const d = r.last_delivery;
  if (!d) return { tone: "done", text: "Nothing left to send" };
  if (d.error) return { tone: "error", text: `Couldn't send ${wall(d.at)}: ${d.error}` };
  return { tone: "done", text: `Sent${d.late ? " late," : ""} ${wall(d.at)}` };
}

// reminderNote is what a row that already leads with the reminder's time
// (reminderWhen) adds about it: why it won't be sent, or how its last send
// went (a failed one even while more are to come). Nothing for a reminder
// that will simply be sent.
export function reminderNote(r: KanbanReminder): ReminderStatus | null {
  if (r.next_fire_at) return r.last_delivery?.error ? deliveryNote(r.last_delivery) : pausedNote(r);
  return r.last_delivery ? deliveryNote(r.last_delivery) : { tone: "done", text: "Nothing left to send" };
}

// pausedNote says why a reminder's next send won't go out, if it won't.
export function pausedNote(r: KanbanReminder): ReminderStatus | null {
  if (!r.paused) return null;
  const { tone, text } = pausedReason[r.paused];
  return { tone, text: text[0].toUpperCase() + text.slice(1) };
}

// deliveryNote says how a send went, without its time.
export function deliveryNote(d: NonNullable<KanbanReminder["last_delivery"]>): ReminderStatus {
  if (d.error) return { tone: "error", text: `Couldn't send: ${d.error}` };
  return { tone: "done", text: d.late ? "Sent late" : "Sent" };
}

export type ReminderGroupKey = "late" | "today" | "tomorrow" | "week" | "later" | "sent";

export interface ReminderGroup {
  key: ReminderGroupKey;
  title: string;
  reminders: KanbanReminder[];
}

const groupTitles: Record<ReminderGroupKey, string> = {
  late: "Late",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  sent: "Sent",
};

// reminderWhen is the moment a reminder's row leads with: its next send, or
// its last one once nothing is left to send.
export const reminderWhen = (r: KanbanReminder): string | null => r.next_fire_at ?? r.last_delivery?.at ?? null;

// groupReminders sorts reminders by when they next reach the owner, in the
// owner's timezone: late (a send now overdue, or a last send that failed),
// today, tomorrow, this week (the next seven days), later, and sent
// (nothing left to send, latest first). A recurring reminder goes by its next
// send. Empty groups are left out.
export function groupReminders(reminders: KanbanReminder[], now: Date, timeZone: string): ReminderGroup[] {
  const today = todayIn(now, timeZone);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 6);
  const keyOf = (r: KanbanReminder): ReminderGroupKey => {
    if (r.last_delivery?.error) return "late";
    if (!r.next_fire_at) return "sent";
    if (Date.parse(r.next_fire_at) < now.getTime()) return "late";
    const day = r.next_fire_at.slice(0, 10);
    if (day <= today) return "today";
    if (day === tomorrow) return "tomorrow";
    return day <= weekEnd ? "week" : "later";
  };
  const time = (r: KanbanReminder) => {
    const at = reminderWhen(r);
    return at ? Date.parse(at) : -Infinity;
  };

  const groups = new Map<ReminderGroupKey, KanbanReminder[]>(
    (Object.keys(groupTitles) as ReminderGroupKey[]).map((k) => [k, []]),
  );
  for (const r of reminders) groups.get(keyOf(r))!.push(r);
  return [...groups]
    .filter(([, rs]) => rs.length > 0)
    .map(([key, rs]) => ({
      key,
      title: groupTitles[key],
      reminders: rs.sort((a, b) => (key === "sent" ? time(b) - time(a) : time(a) - time(b))),
    }));
}

// ScheduleFields is a schedule as the reminder form edits it: every
// preset's fields at once, so switching presets keeps what was typed.
export interface ScheduleFields {
  kind: KanbanSchedule["kind"];
  at: string; // datetime-local, in the owner's timezone
  time: string; // HH:MM
  weekdays: KanbanWeekday[];
  days: string;
  from: string; // YYYY-MM-DD, or empty for today
}

// fieldsOf fills the form from a schedule, or with a new reminder's defaults.
export function fieldsOf(s?: KanbanSchedule): ScheduleFields {
  const f: ScheduleFields = { kind: "once", at: "", time: "07:00", weekdays: [], days: "2", from: "" };
  if (!s) return f;
  switch (s.kind) {
    case "once":
      return { ...f, kind: "once", at: toInputValue(s.at) };
    case "daily":
      return { ...f, kind: "daily", time: s.time };
    case "weekly":
      return { ...f, kind: "weekly", time: s.time, weekdays: s.weekdays };
    case "every":
      return { ...f, kind: "every", time: s.time, days: String(s.days), from: s.from };
  }
}

export type ScheduleField = "at" | "time" | "weekdays" | "days" | "from";

// scheduleOf reads the form's schedule, or names the field to fix.
export function scheduleOf(
  f: ScheduleFields,
): { schedule: KanbanScheduleInput } | { field: ScheduleField; error: string } {
  if (f.kind === "once") {
    return f.at ? { schedule: { kind: "once", at: f.at } } : { field: "at", error: "Choose when it should reach you." };
  }
  if (!f.time) return { field: "time", error: "Choose a time of day." };
  switch (f.kind) {
    case "daily":
      return { schedule: { kind: "daily", time: f.time } };
    case "weekly": {
      const weekdays = (Object.keys(weekdayNames) as KanbanWeekday[]).filter((d) => f.weekdays.includes(d));
      if (weekdays.length === 0) return { field: "weekdays", error: "Pick at least one day." };
      return { schedule: { kind: "weekly", time: f.time, weekdays } };
    }
    case "every": {
      const days = Number(f.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return { field: "days", error: "Repeat every 1 to 365 days." };
      }
      return { schedule: { kind: "every", time: f.time, days, ...(f.from && { from: f.from }) } };
    }
  }
}

// reminderEdit is the edit to save for a reminder whose form now holds
// message and schedule: the schedule only if it changed, since a new
// schedule reschedules (and re-arms) the reminder.
export function reminderEdit(current: KanbanSchedule, message: string, schedule: KanbanScheduleInput): KanbanReminderEdit {
  const before = scheduleOf(fieldsOf(current));
  const changed = !("schedule" in before) || JSON.stringify(before.schedule) !== JSON.stringify(schedule);
  return { message, ...(changed && { schedule }) };
}
