import type { KanbanBoard } from "@/types/kanban";
import { apiBaseUrl } from "@/lib/api";

const boardsUrl = `${apiBaseUrl}/api/coreban/boards`;

// Thrown when a board is missing. coreban answers 404 for both "never
// existed" and "belongs to someone else", and the message must not
// distinguish them either.
export class KanbanBoardNotFoundError extends Error {
  constructor() {
    super("Board not found — it may have been deleted on another device");
    this.name = "KanbanBoardNotFoundError";
  }
}

async function throwIfError(res: Response, op: string): Promise<void> {
  if (res.status === 404) throw new KanbanBoardNotFoundError();
  if (!res.ok) throw new Error(`Error ${op}: ${res.status}`);
}

export async function fetchKanbanBoards(): Promise<KanbanBoard[]> {
  const res = await fetch(boardsUrl, { credentials: "include" });
  await throwIfError(res, "fetching boards");
  return res.json();
}

export async function createKanbanBoard(name: string): Promise<KanbanBoard> {
  const res = await fetch(boardsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  await throwIfError(res, "creating board");
  return res.json();
}

export async function renameKanbanBoard(id: string, name: string): Promise<KanbanBoard> {
  const res = await fetch(`${boardsUrl}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  await throwIfError(res, "renaming board");
  return res.json();
}

export async function deleteKanbanBoard(id: string): Promise<void> {
  const res = await fetch(`${boardsUrl}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await throwIfError(res, "deleting board");
}
