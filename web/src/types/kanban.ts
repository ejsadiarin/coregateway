// Status is where a card stands (coreban ADR-0001): a fixed set shared by
// every board. Each column belongs to exactly one.
export type KanbanStatus = "todo" | "in_progress" | "done";

export interface KanbanColumn {
  id: string;
  name: string;
  status: KanbanStatus;
  position: number;
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
