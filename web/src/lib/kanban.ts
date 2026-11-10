import type {
  KanbanBoard,
  KanbanCard,
  KanbanCardEdit,
  KanbanColumn,
  KanbanColumnEdit,
  KanbanLabel,
  KanbanReminder,
  KanbanReminderEdit,
  KanbanSettings,
} from "@/types/kanban";
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

// Thrown when a card is missing from its board (or the board is gone).
export class KanbanCardNotFoundError extends Error {
  constructor() {
    super("Card not found — it may have been changed on another device");
    this.name = "KanbanCardNotFoundError";
  }
}

// Thrown when coreban refuses a request the owner can fix (400, 409).
// detail is coreban's own explanation, e.g. "ntfy_topic must start with
// coreban-", for showing beside the field it names.
export class KanbanRequestError extends Error {
  constructor(
    op: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail ? `Error ${op}: ${detail}` : `Error ${op}: ${status}`);
    this.name = "KanbanRequestError";
  }
}

async function throwIfError(
  res: Response,
  op: string,
  notFound: () => Error = () => new KanbanBoardNotFoundError(),
): Promise<void> {
  if (res.status === 404) throw notFound();
  if (res.status === 400 || res.status === 409) {
    const body = await res.json().catch(() => null);
    throw new KanbanRequestError(op, res.status, typeof body?.error === "string" ? body.error : "");
  }
  if (!res.ok) throw new Error(`Error ${op}: ${res.status}`);
}

const cardNotFound = () => new KanbanCardNotFoundError();

const columnNotFound = () => new Error("Column not found — it may have been changed on another device");

const reminderNotFound = () => new Error("Reminder not found — it may have been deleted on another device");

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

// fetchKanbanBoard returns one board with its columns in order, each
// carrying its cards in priority order.
export async function fetchKanbanBoard(id: string): Promise<KanbanBoard> {
  const res = await fetch(`${boardsUrl}/${id}`, { credentials: "include" });
  await throwIfError(res, "fetching board");
  return res.json();
}

const cardsUrl = (boardId: string) => `${boardsUrl}/${boardId}/cards`;

export async function createKanbanCard(
  boardId: string,
  columnId: string,
  title: string,
): Promise<KanbanCard> {
  const res = await fetch(cardsUrl(boardId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ column_id: columnId, title }),
  });
  await throwIfError(res, "creating card");
  return res.json();
}

export async function editKanbanCard(
  boardId: string,
  cardId: string,
  edit: KanbanCardEdit,
): Promise<KanbanCard> {
  const res = await fetch(`${cardsUrl(boardId)}/${cardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(edit),
  });
  await throwIfError(res, "saving card", cardNotFound);
  return res.json();
}

// fetchKanbanArchivedCards lists a board's archived cards, most recently
// archived first.
export async function fetchKanbanArchivedCards(boardId: string): Promise<KanbanCard[]> {
  const res = await fetch(`${cardsUrl(boardId)}?archived=true`, { credentials: "include" });
  await throwIfError(res, "fetching archived cards");
  return res.json();
}

// deleteKanbanCard removes a card for good, archived or not.
export async function deleteKanbanCard(boardId: string, cardId: string): Promise<void> {
  const res = await fetch(`${cardsUrl(boardId)}/${cardId}`, { method: "DELETE", credentials: "include" });
  await throwIfError(res, "deleting card", cardNotFound);
}

// moveKanbanCard puts a card into a column at index, its slot among that
// column's other cards (top is 0). The card's status follows the column.
export async function moveKanbanCard(
  boardId: string,
  cardId: string,
  columnId: string,
  index: number,
): Promise<KanbanCard> {
  const res = await fetch(`${cardsUrl(boardId)}/${cardId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ column_id: columnId, index }),
  });
  await throwIfError(res, "moving card", cardNotFound);
  return res.json();
}

const columnsUrl = (boardId: string) => `${boardsUrl}/${boardId}/columns`;

// addKanbanColumn appends a column with a status to the board.
export async function addKanbanColumn(boardId: string, column: Required<KanbanColumnEdit>): Promise<KanbanColumn> {
  const res = await fetch(columnsUrl(boardId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(column),
  });
  await throwIfError(res, "adding column");
  return res.json();
}

// editKanbanColumn renames a column or changes its status. coreban refuses
// (409) to leave a status with no column on the board.
export async function editKanbanColumn(boardId: string, columnId: string, edit: KanbanColumnEdit): Promise<KanbanColumn> {
  const res = await fetch(`${columnsUrl(boardId)}/${columnId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(edit),
  });
  await throwIfError(res, "saving column", columnNotFound);
  return res.json();
}

// moveKanbanColumn puts a column at index among the board's other columns
// (leftmost is 0).
export async function moveKanbanColumn(boardId: string, columnId: string, index: number): Promise<KanbanColumn> {
  const res = await fetch(`${columnsUrl(boardId)}/${columnId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ index }),
  });
  await throwIfError(res, "moving column", columnNotFound);
  return res.json();
}

// deleteKanbanColumn removes an empty column. coreban refuses (409) one
// holding cards or the board's last column of its status.
export async function deleteKanbanColumn(boardId: string, columnId: string): Promise<void> {
  const res = await fetch(`${columnsUrl(boardId)}/${columnId}`, { method: "DELETE", credentials: "include" });
  await throwIfError(res, "deleting column", columnNotFound);
}

const labelsUrl = (boardId: string) => `${boardsUrl}/${boardId}/labels`;

const labelNotFound = () => new Error("Label not found — it may have been deleted on another device");

// fetchKanbanLabels lists the board's labels by name.
export async function fetchKanbanLabels(boardId: string): Promise<KanbanLabel[]> {
  const res = await fetch(labelsUrl(boardId), { credentials: "include" });
  await throwIfError(res, "fetching labels");
  return res.json();
}

// createKanbanLabel defines a label on the board. coreban refuses (409) a
// name the board already has, ignoring case.
export async function createKanbanLabel(boardId: string, name: string): Promise<KanbanLabel> {
  const res = await fetch(labelsUrl(boardId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  await throwIfError(res, "creating label");
  return res.json();
}

export async function renameKanbanLabel(boardId: string, labelId: string, name: string): Promise<KanbanLabel> {
  const res = await fetch(`${labelsUrl(boardId)}/${labelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  await throwIfError(res, "renaming label", labelNotFound);
  return res.json();
}

// deleteKanbanLabel deletes a label, taking it off every card.
export async function deleteKanbanLabel(boardId: string, labelId: string): Promise<void> {
  const res = await fetch(`${labelsUrl(boardId)}/${labelId}`, { method: "DELETE", credentials: "include" });
  await throwIfError(res, "deleting label", labelNotFound);
}

// setKanbanCardLabel applies (on) or removes one of the board's labels on a
// card.
export async function setKanbanCardLabel(boardId: string, cardId: string, labelId: string, on: boolean): Promise<void> {
  const res = await fetch(`${cardsUrl(boardId)}/${cardId}/labels/${labelId}`, {
    method: on ? "PUT" : "DELETE",
    credentials: "include",
  });
  await throwIfError(res, on ? "applying label" : "removing label", labelNotFound);
}

const settingsUrl = `${apiBaseUrl}/api/coreban/settings`;

export async function fetchKanbanSettings(): Promise<KanbanSettings> {
  const res = await fetch(settingsUrl, { credentials: "include" });
  await throwIfError(res, "fetching settings");
  return res.json();
}

export async function saveKanbanSettings(settings: KanbanSettings): Promise<KanbanSettings> {
  const res = await fetch(settingsUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(settings),
  });
  await throwIfError(res, "saving settings");
  return res.json();
}

const remindersUrl = `${apiBaseUrl}/api/coreban/reminders`;

// fetchKanbanReminders lists the owner's reminders, soonest first.
export async function fetchKanbanReminders(): Promise<KanbanReminder[]> {
  const res = await fetch(remindersUrl, { credentials: "include" });
  await throwIfError(res, "fetching reminders");
  return res.json();
}

export async function createKanbanReminder(input: Required<KanbanReminderEdit>): Promise<KanbanReminder> {
  const res = await fetch(remindersUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  await throwIfError(res, "creating reminder");
  return res.json();
}

export async function editKanbanReminder(id: string, edit: KanbanReminderEdit): Promise<KanbanReminder> {
  const res = await fetch(`${remindersUrl}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(edit),
  });
  await throwIfError(res, "saving reminder", reminderNotFound);
  return res.json();
}

export async function deleteKanbanReminder(id: string): Promise<void> {
  const res = await fetch(`${remindersUrl}/${id}`, { method: "DELETE", credentials: "include" });
  await throwIfError(res, "deleting reminder", reminderNotFound);
}
