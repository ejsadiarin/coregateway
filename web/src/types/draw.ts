import type { TLStoreSnapshot } from "tldraw";

// Board mirrors the coredraw GET /api/coredraw/boards/:id response:
// one diagram canvas plus its side doc, saved and synced together.
export interface Board {
  id: string;
  title: string;
  snapshot: TLStoreSnapshot | null;
  snapshot_version: number;
  doc: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
