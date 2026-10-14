import type { TLStoreSnapshot } from "tldraw";
import type { Board } from "@/types/draw";
import { apiBaseUrl } from "@/lib/api";

// The tldraw snapshot schema version this client writes. It rides in every
// save so the server row records which client produced the snapshot, and it
// must roll together with the pinned tldraw dependency.
export const snapshotVersion = 1;

export interface SaveBoardInput {
  snapshot: TLStoreSnapshot;
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

export async function fetchBoard(id: string): Promise<Board> {
  const res = await fetch(`${apiBaseUrl}/api/coredraw/boards/${id}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Error fetching board: ${res.status}`);
  }
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
  if (!res.ok) {
    throw new Error(`Error saving board: ${res.status}`);
  }
  return res.json();
}
