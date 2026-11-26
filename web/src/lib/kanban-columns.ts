import type { KanbanColumn, KanbanStatus } from "@/types/kanban";

// statusLabel names each status as the owner reads it.
export const statusLabel: Record<KanbanStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

// columnOption names a column in a picker: "Doing · In progress", or just
// "Todo" when the column is already named after its status.
export const columnOption = (c: Pick<KanbanColumn, "name" | "status">) =>
  c.name.trim().toLowerCase() === statusLabel[c.status].toLowerCase() ? c.name : `${c.name} · ${statusLabel[c.status]}`;

// newCardColumn is the column a new card starts in: the one asked for while
// the board still has it, else the board's first Todo column, else its first.
export function newCardColumn(columns: Pick<KanbanColumn, "id" | "status">[], asked?: string): string {
  if (asked && columns.some((c) => c.id === asked)) return asked;
  return (columns.find((c) => c.status === "todo") ?? columns[0])?.id ?? "";
}
