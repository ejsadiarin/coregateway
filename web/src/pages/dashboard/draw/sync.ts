// Engine-agnostic board sync: load, debounced autosave, revision guard and
// conflict state, moved out of the canvas-coupled page so the drawing engine
// can be swapped underneath without touching any of this.
//
// The controller never sees a drawing type. It moves an opaque snapshot in and
// out through `SyncEngine`: `capture` reads the current document from whatever
// engine is mounted, `apply` hands a loaded document back to it. The board API
// (Seam A, lib/draw.ts) is the only I/O this module does.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchBoard,
  saveBoard,
  snapshotVersion,
  StaleRevisionError,
  type SaveBoardInput,
} from "@/lib/draw";
import type { Board } from "@/types/draw";

export type Phase = "loading" | "ready" | "error";
export type SaveState = "saved" | "saving" | "failed" | "conflict";

export type BoardMeta = Pick<Board, "id" | "title" | "doc" | "revision">;

// The winning revision when our save is rejected, or "unavailable" when the
// refetch that would learn it fails too.
export type Conflict = { serverRevision: number | "unavailable" };

// Debounce between the last user edit and the snapshot PUT. Tight enough that
// a closed tab loses at most this much work; loose enough that dragging a
// shape doesn't spam the API.
export const AUTOSAVE_DELAY_MS = 1500;

// The engine-facing half of the bridge. Implemented by the page (or the canvas
// adapter) so the controller stays ignorant of the drawing engine.
export interface SyncEngine {
  // The opaque snapshot to persist, or null when the engine has nothing worth
  // saving yet (e.g. not mounted). null is treated as "skip this save".
  capture(): unknown | null;
  // Replace the engine's document with a loaded snapshot. `version` is the
  // board row's `snapshot_version`, which the engine uses to accept or discard
  // the blob.
  apply(snapshot: unknown, version: number): void;
}

export interface BoardSync {
  phase: Phase;
  loadError: string;
  meta: BoardMeta | null;
  saveState: SaveState;
  conflict: Conflict | null;
  // Mark the document dirty and arm the debounced save.
  scheduleSave(): void;
  // Fold a doc edit into the board meta and arm the same debounced save.
  updateDoc(doc: string): void;
  reloadLatest(): void;
  // Clear the conflict banner ("keep editing" — the user accepts the risk).
  dismissConflict(): void;
}

// The save body for a document + its board meta. Shared by the debounced
// autosave and the unmount flush so both send the same shape.
function saveInput(snapshot: unknown, meta: BoardMeta): SaveBoardInput {
  return { snapshot, snapshotVersion, doc: meta.doc, revision: meta.revision };
}

export function useBoardSync(boardId: string | undefined, engine: SyncEngine): BoardSync {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const loadedRef = useRef<{ snapshot: unknown; version: number } | null>(null);
  const metaRef = useRef<BoardMeta | null>(null);
  const engineRef = useRef(engine);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // An edit waiting out the autosave debounce, cached so unmount can flush it
  // without touching the engine (already disposed by then — children clean up
  // before parent effects).
  const pendingRef = useRef<unknown | null>(null);

  metaRef.current = meta;
  engineRef.current = engine;

  const applyCurrent = useCallback(() => {
    const loaded = loadedRef.current;
    if (loaded) engineRef.current.apply(loaded.snapshot, loaded.version);
  }, []);

  const load = useCallback(
    async (id: string) => {
      setPhase("loading");
      setLoadError("");
      setConflict(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try {
        const board = await fetchBoard(id);
        if (!alive.current) return;
        loadedRef.current = { snapshot: board.snapshot, version: board.snapshot_version };
        setMeta({ id: board.id, title: board.title, doc: board.doc, revision: board.revision });
        setSaveState("saved");
        pendingRef.current = null;
        setPhase("ready");
        applyCurrent();
      } catch (err) {
        if (!alive.current) return;
        setLoadError(err instanceof Error ? err.message : "Couldn't open this board");
        setPhase("error");
      }
    },
    [applyCurrent],
  );

  useEffect(() => {
    alive.current = true;
    if (boardId) {
      void load(boardId);
    } else {
      setLoadError("No board selected yet — board picking lands with board management.");
      setPhase("error");
    }
    return () => {
      // Switching boards (or leaving the route) unmounts us: flush a
      // still-debounced edit instead of dropping it. Fire-and-forget — the
      // revision guard keeps a concurrent save from being overwritten.
      alive.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const current = metaRef.current;
      const pending = pendingRef.current;
      if (current && pending !== null) {
        void saveBoard(current.id, saveInput(pending, current)).catch((err) => {
          console.warn("board switch flush failed", err);
        });
      }
      pendingRef.current = null;
    };
  }, [boardId, load]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const current = metaRef.current;
    if (!current) return true;
    const snapshot = engineRef.current.capture();
    if (snapshot === null) return true;
    setSaveState("saving");
    try {
      const updated = await saveBoard(current.id, saveInput(snapshot, current));
      if (!alive.current) return true;
      setMeta({ ...current, revision: updated.revision });
      setSaveState("saved");
      pendingRef.current = null;
      return true;
    } catch (err) {
      if (!alive.current) return false;
      if (err instanceof StaleRevisionError) {
        // Never overwrite: refetch to learn the winning revision, then ask.
        try {
          const latest = await fetchBoard(current.id);
          if (!alive.current) return false;
          setConflict({ serverRevision: latest.revision });
        } catch {
          if (!alive.current) return false;
          setConflict({ serverRevision: "unavailable" });
        }
        setSaveState("conflict");
      } else {
        // Transient failure: keep the edits locally, retry on the next edit.
        // pending stays set so unmount still flushes instead of dropping them.
        setSaveState("failed");
      }
      return false;
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot = engineRef.current.capture();
    if (snapshot !== null) pendingRef.current = snapshot;
    saveTimer.current = setTimeout(() => void doSave(), AUTOSAVE_DELAY_MS);
  }, [doSave]);

  // Doc edits ride the same debounced save as canvas edits: the doc string
  // lives in the board meta, and doSave reads it from metaRef at fire time
  // (after this render commits), so no save-path changes are needed.
  const updateDoc = useCallback(
    (doc: string) => {
      setMeta((m) => (m ? { ...m, doc } : m));
      scheduleSave();
    },
    [scheduleSave],
  );

  const reloadLatest = useCallback(() => {
    if (boardId) void load(boardId);
  }, [boardId, load]);

  const dismissConflict = useCallback(() => setConflict(null), []);

  return {
    phase,
    loadError,
    meta,
    saveState,
    conflict,
    scheduleSave,
    updateDoc,
    reloadLatest,
    dismissConflict,
  };
}
