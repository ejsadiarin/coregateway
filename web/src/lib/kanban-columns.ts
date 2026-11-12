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
