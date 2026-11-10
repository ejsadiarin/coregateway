// Status is where a card stands (coreban ADR-0001): a fixed set shared by
// every board. Each column belongs to exactly one.
export type KanbanStatus = "todo" | "in_progress" | "done";

// KanbanCard mirrors coreban's card responses. status is always the
// column's (ADR-0001), reported for convenience, never set directly.
export interface KanbanCard {
  id: string;
  board_id: string;
  column_id: string;
  status: KanbanStatus;
  title: string;
  description: string;
  // The board's labels applied to this card, by name.
  labels: KanbanLabel[];
  due: KanbanDue | null;
  // Set while the card is archived: hidden from its board, but kept.
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// KanbanLabel is a named tag defined on one board and applied to its cards.
// Names are unique within a board, ignoring case.
export interface KanbanLabel {
  id: string;
  name: string;
}

// KanbanDue is when a card is expected to be finished: a calendar date, or
// an instant (RFC 3339 in the owner's timezone). Requests may send at as a
// wall-clock time with no offset, read in the owner's timezone.
export type KanbanDue = { date: string } | { at: string };

// KanbanCardEdit is a partial card edit: fields left out stay as they are.
// due: null clears it; archived: false restores the card to the bottom of
// its column.
export interface KanbanCardEdit {
  title?: string;
  description?: string;
  due?: KanbanDue | null;
  archived?: boolean;
}

export interface KanbanColumn {
  id: string;
  name: string;
  status: KanbanStatus;
  position: number;
  // Cards in priority order; present on a single board's columns.
  cards?: KanbanCard[];
}

// KanbanColumnEdit is a partial column edit: fields left out stay as they
// are. Adding a column needs both.
export interface KanbanColumnEdit {
  name?: string;
  status?: KanbanStatus;
}

// KanbanBoard mirrors coreban's board responses. Lists omit columns; a
// single board (GET /api/coreban/boards/:id) carries them in board order.
export interface KanbanBoard {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  columns?: KanbanColumn[];
}

// KanbanSettings mirrors coreban's settings: the owner's notification
// target (an ntfy topic name under coreban-, or null for none) and the IANA
// timezone their schedules are read in.
export interface KanbanSettings {
  ntfy_topic: string | null;
  timezone: string;
}

// KanbanReminder mirrors coreban's reminders. Times are RFC 3339 in the
// owner's timezone. next_fire_at is null once nothing is left to send;
// paused says why it won't be sent when it comes.
export interface KanbanReminder {
  id: string;
  message: string;
  schedule: KanbanSchedule;
  next_fire_at: string | null;
  paused: "no_notification_target" | null;
  last_delivery: { at: string; late: boolean; error: string | null } | null;
  created_at: string;
  updated_at: string;
}

// KanbanSchedule is when a reminder fires: once at a moment (RFC 3339 in
// the owner's timezone), or a recurring preset at a time of day ("07:00")
// in the owner's timezone.
export type KanbanSchedule =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekdays: KanbanWeekday[] }
  | { kind: "every"; time: string; days: number; from: string };

// KanbanWeekday is an iCalendar day code.
export type KanbanWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

// KanbanScheduleInput is a schedule as sent: a one-off's at may be a
// wall-clock time with no offset, and an every-N-days from defaults to
// today.
export type KanbanScheduleInput =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekdays: KanbanWeekday[] }
  | { kind: "every"; time: string; days: number; from?: string };

// KanbanReminderEdit is a partial edit: fields left out stay as they are.
export interface KanbanReminderEdit {
  message?: string;
  schedule?: KanbanScheduleInput;
}
