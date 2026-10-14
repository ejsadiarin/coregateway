import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Tldraw, getSnapshot, loadSnapshot, type Editor, type TLStoreSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { fetchBoard, saveBoard, snapshotVersion, StaleRevisionError } from "@/lib/draw";
import type { Board } from "@/types/draw";

// Debounce between the last user edit and the snapshot PUT. Tight enough
// that a closed tab loses at most this much work; loose enough that
// dragging a shape doesn't spam the API.
const AUTOSAVE_DELAY_MS = 1500;

type Phase = "loading" | "ready" | "error";
type SaveState = "saved" | "saving" | "failed" | "conflict";

type BoardMeta = Pick<Board, "id" | "title" | "doc" | "revision">;

// The winning revision when our save is rejected, or "unavailable" when the
// refetch that would learn it fails too.
type Conflict = { serverRevision: number | "unavailable" };

// Fresh boards carry the DB default ({}) rather than a real snapshot.
// Only hand tldraw something with the store+schema shape it requires;
// anything else means "blank canvas".
function asStoreSnapshot(value: unknown): TLStoreSnapshot | null {
  if (value && typeof value === "object" && "store" in value && "schema" in value) {
    return value as TLStoreSnapshot;
  }
  return null;
}

export default function DrawPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef<TLStoreSnapshot | null>(null);
  const metaRef = useRef<BoardMeta | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  metaRef.current = meta;

  const applySnapshot = useCallback(() => {
    const editor = editorRef.current;
    if (editor && snapshotRef.current) {
      loadSnapshot(editor.store, { document: snapshotRef.current });
    }
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
        snapshotRef.current = asStoreSnapshot(board.snapshot);
        setMeta({ id: board.id, title: board.title, doc: board.doc, revision: board.revision });
        setSaveState("saved");
        setPhase("ready");
        applySnapshot();
      } catch (err) {
        if (!alive.current) return;
        setLoadError(err instanceof Error ? err.message : "Couldn't open this board");
        setPhase("error");
      }
    },
    [applySnapshot],
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
      alive.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [boardId, load]);

  const doSave = useCallback(async () => {
    const editor = editorRef.current;
    const current = metaRef.current;
    if (!editor || !current) return;
    setSaveState("saving");
    const document = getSnapshot(editor.store).document;
    try {
      const updated = await saveBoard(current.id, {
        snapshot: document,
        snapshotVersion,
        doc: current.doc,
        revision: current.revision,
      });
      if (!alive.current) return;
      setMeta({ ...current, revision: updated.revision });
      setSaveState("saved");
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof StaleRevisionError) {
        // Never overwrite: refetch to learn the winning revision, then ask.
        try {
          const latest = await fetchBoard(current.id);
          if (!alive.current) return;
          setConflict({ serverRevision: latest.revision });
        } catch {
          if (!alive.current) return;
          setConflict({ serverRevision: "unavailable" });
        }
        setSaveState("conflict");
      } else {
        // Transient failure: keep the edits locally, retry on the next edit.
        setSaveState("failed");
      }
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void doSave(), AUTOSAVE_DELAY_MS);
  }, [doSave]);

  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      applySnapshot();
      const unsubscribe = editor.store.listen(scheduleSave, { source: "user", scope: "document" });
      return () => {
        unsubscribe();
        editorRef.current = null;
      };
    },
    [applySnapshot, scheduleSave],
  );

  const reloadLatest = useCallback(() => {
    if (boardId) void load(boardId);
  }, [boardId, load]);

  if (phase === "loading") {
    return (
      <div className="flex h-full min-h-[500px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Opening board...
          </span>
        </div>
      </div>
    );
  }

  if (phase === "error" || !meta) {
    return (
      <div className="flex h-full min-h-[500px] items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold">Couldn't open this board</h2>
          <p className="mt-2 text-sm text-muted-foreground">{loadError || "Unknown error"}</p>
          {boardId && (
            <button
              type="button"
              onClick={reloadLatest}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[500px]">
      <Tldraw onMount={onMount} />

      <div className="pointer-events-none absolute bottom-20 right-4 flex items-center gap-2 rounded-md bg-background/90 px-3 py-1.5 text-xs shadow backdrop-blur md:bottom-4">
        <span className="max-w-48 truncate font-medium">{meta.title}</span>
        <span className="text-muted-foreground">
          {saveState === "saving"
            ? "Saving..."
            : saveState === "conflict"
              ? `Not saved · rev ${meta.revision} is stale`
              : `Saved · rev ${meta.revision}`}
        </span>
        {saveState === "failed" && (
          <span className="text-destructive">Save failed — will retry on next edit</span>
        )}
      </div>

      {conflict !== null && (
        <div className="absolute left-1/2 top-16 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border border-amber-500/50 bg-background px-4 py-3 shadow-lg">
          <p className="text-sm font-medium">This board changed on another device</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {conflict.serverRevision !== "unavailable"
              ? `Someone saved revision ${conflict.serverRevision} while you were editing (you have ${meta.revision}). Reloading replaces this canvas with the latest — anything you drew since will be lost.`
              : "Someone saved while you were editing. Reloading replaces this canvas with the latest — anything you drew since will be lost."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={reloadLatest}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Reload latest
            </button>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Keep editing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
