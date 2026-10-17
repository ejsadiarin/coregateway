import type { Board, BoardSummary } from "@/types/draw";
import { apiBaseUrl } from "@/lib/api";

// The snapshot schema version this client writes. It rides in every save so
// the server row records which client produced the snapshot, and it rolls
// together with the canvas engine.
export const snapshotVersion = 1;

export interface SaveBoardInput {
  // Opaque to the client layer: the board API stores and returns it verbatim,
  // so the drawing engine can change without touching this contract.
  snapshot: unknown;
  snapshotVersion: number;
  doc: string;
  revision: number;
}

// Thrown when a save carries a revision the server has moved past.
// The 409 body carries no server state, so the caller refetches to learn it.
export class StaleRevisionError extends Error {
  constructor() {
    super("Board changed elsewhere — reload the latest before saving");
    this.name = "StaleRevisionError";
  }
}

// Thrown when a board is missing. The server answers 404 for both
// "never existed" and "belongs to someone else", and the message must
// not distinguish them either.
export class BoardNotFoundError extends Error {
  constructor() {
    super("Board not found — it may have been deleted on another device");
    this.name = "BoardNotFoundError";
  }
}

async function throwIfBoardError(res: Response, op: string): Promise<void> {
  if (res.status === 404) {
    throw new BoardNotFoundError();
  }
  if (!res.ok) {
    throw new Error(`Error ${op}: ${res.status}`);
  }
}

export async function fetchBoards(): Promise<BoardSummary[]> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards`, {
    credentials: "include",
  });
  await throwIfBoardError(res, "fetching boards");
  return res.json();
}

export async function createBoard(title: string): Promise<Board> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ title }),
  });
  await throwIfBoardError(res, "creating board");
  return res.json();
}

export async function fetchBoard(id: string): Promise<Board> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards/${id}`, {
    credentials: "include",
  });
  await throwIfBoardError(res, "fetching board");
  return res.json();
}

export async function saveBoard(id: string, input: SaveBoardInput): Promise<Board> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      snapshot: input.snapshot,
      snapshot_version: input.snapshotVersion,
      doc: input.doc,
      revision: input.revision,
    }),
  });
  if (res.status === 409) {
    throw new StaleRevisionError();
  }
  await throwIfBoardError(res, "saving board");
  return res.json();
}

export async function renameBoard(id: string, title: string): Promise<Board> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ title }),
  });
  await throwIfBoardError(res, "renaming board");
  return res.json();
}

export async function deleteBoard(id: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await throwIfBoardError(res, "deleting board");
}
