import type { KanbanReminder, KanbanStatus } from "@/types/kanban";

// Note mirrors coreban's note responses: an item in the owner's Feed,
// either free text the owner posted or a window onto one linked record.
export interface Note {
  id: string;
  // A plain note's text; empty on a linked note.
  text: string;
  // The record a linked note shows; null on a plain note.
  link: NoteLink | null;
  // Set while the note is archived: collapsed in the Feed, kept, and still
  // in its place.
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// FeedPage is one page of the Feed, oldest first. older is the cursor for
// the page before it, null once the page reaches the first note.
export interface FeedPage {
  notes: Note[];
  older: string | null;
}

// NoteLink is the one record a note shows: live while it exists, and its
// last state once deleted (deleted: true). reminder or card is set for its
// kind, unless a deleted record left nothing behind.
export type NoteLink =
  | { kind: "reminder"; deleted: boolean; reminder?: KanbanReminder }
  | { kind: "card"; deleted: boolean; card?: NoteCard };

// NoteCard is a linked card as its note shows it.
export interface NoteCard {
  id: string;
  board_id: string;
  board_name: string;
  column_name: string;
  status: KanbanStatus;
  title: string;
  archived_at: string | null;
}
