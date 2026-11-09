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
