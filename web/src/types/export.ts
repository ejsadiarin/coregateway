// The official export and import (coregateway ADR-0008): mirrors the
// gateway's /api/export and /api/import and the shared part result.

export type PartStatus = "imported" | "skipped" | "failed";

export interface PartCount {
  created: number;
  skipped: number;
}

export interface PartError {
  entity: string;
  id?: string;
  reason: string;
}

export interface PartResult {
  part: string;
  format?: string;
  version?: number;
  dry_run: boolean;
  status: PartStatus;
  counts: Record<string, PartCount>;
  errors: PartError[];
  // What an import left out, such as a photo whose file isn't stored.
  warnings?: PartError[];
}

export interface ImportResponse {
  dry_run: boolean;
  parts: Record<string, PartResult>;
}

// One part found in a chosen file. version 0 is an export from before
// parts were versioned; known is whether this gateway has the part.
export interface FilePart {
  name: string;
  format: string;
  version: number;
  known: boolean;
}
