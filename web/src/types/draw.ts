// BoardSummary is the list-view shape: identity and freshness, no payload.
export interface BoardSummary {
  id: string;
  title: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

// Board mirrors the coredraw GET /api/coredraw/boards/:id response:
// one diagram canvas plus its side doc, saved and synced together. The
// snapshot is opaque to the server (and to this type) — the canvas engine owns
// its shape.
export interface Board extends BoardSummary {
  snapshot: unknown;
  snapshot_version: number;
  doc: string;
}
