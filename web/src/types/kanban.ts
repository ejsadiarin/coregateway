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
  created_at: string;
  updated_at: string;
}

// KanbanCardEdit is a partial card edit: fields left out stay as they are.
export interface KanbanCardEdit {
  title?: string;
  description?: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
  status: KanbanStatus;
  position: number;
  // Cards in priority order; present on a single board's columns.
  cards?: KanbanCard[];
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

// KanbanSchedule is when a reminder fires. Requests may send at as a
// wall-clock time with no offset ("2026-11-10T07:00"), read in the owner's
// timezone.
export interface KanbanSchedule {
  kind: "once";
  at: string;
}

// KanbanReminderEdit is a partial edit: fields left out stay as they are.
export interface KanbanReminderEdit {
  message?: string;
  schedule?: KanbanSchedule;
}
