import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLComponents,
  type TLStoreSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";
import { fetchBoard, saveBoard, snapshotVersion, StaleRevisionError } from "@/lib/draw";
import { installJsonPasteHandler, isTextEntryTarget } from "@/pages/dashboard/draw/jsonclipboard";
import { ICON_SHAPE_UTILS } from "@/pages/dashboard/draw/icon-shape";
import { DocPane } from "@/pages/dashboard/draw/docpane";
import { drawUiOverrides } from "@/pages/dashboard/draw/shortcuts";
import { IconPalette, TopBar, ToolRail, type PaletteTab } from "@/pages/dashboard/draw/editor-ui";
import type { SaveBoardInput } from "@/lib/draw";
import type { Board } from "@/types/draw";

// Strip tldraw's default chrome so our own rail + palette own the layout.
// StylePanel, NavigationPanel, context menu, dialogs and the main menu stay
// (working export/theme/zoom beats a dead button).
const TLDRAW_COMPONENTS: TLComponents = {
  Toolbar: null,
  PageMenu: null,
  SharePanel: null,
  HelperButtons: null,
  Minimap: null,
  QuickActions: null,
  DebugPanel: null,
  DebugMenu: null,
};

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

// The save body for a document + its board meta. Shared by the debounced
// autosave and the unmount flush so both send the same shape.
function saveInput(snapshot: TLStoreSnapshot, meta: BoardMeta): SaveBoardInput {
  return { snapshot, snapshotVersion, doc: meta.doc, revision: meta.revision };
}

export default function DrawPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [paletteTab, setPaletteTab] = useState<PaletteTab>("icons");
  const [docOpen, setDocOpen] = useState(true);
  const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);

  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef<TLStoreSnapshot | null>(null);
  const metaRef = useRef<BoardMeta | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // An edit waiting out the autosave debounce, with the latest document
  // cached alongside so unmount can flush it without touching the editor
  // (already disposed by then — children clean up before parent effects).
  const pendingRef = useRef<{ snapshot: TLStoreSnapshot } | null>(null);

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
        pendingRef.current = null;
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
      // Switching boards (or leaving the route) unmounts us: flush a
      // still-debounced edit instead of dropping it. Fire-and-forget — the
      // revision guard keeps a concurrent save from being overwritten.
      alive.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const meta = metaRef.current;
      const pending = pendingRef.current;
      if (meta && pending) {
        void saveBoard(meta.id, saveInput(pending.snapshot, meta)).catch((err) => {
          console.warn("board switch flush failed", err);
        });
      }
      pendingRef.current = null;
    };
  }, [boardId, load]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    const current = metaRef.current;
    if (!editor || !current) return true;
    setSaveState("saving");
    const document = getSnapshot(editor.store).document;
    try {
      const updated = await saveBoard(current.id, saveInput(document, current));
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
    const editor = editorRef.current;
    if (editor) {
      pendingRef.current = { snapshot: getSnapshot(editor.store).document };
    }
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

  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setMountedEditor(editor);
      applySnapshot();
      const uninstallPaste = installJsonPasteHandler(editor);
      const unsubscribe = editor.store.listen(scheduleSave, { source: "user", scope: "document" });
      return () => {
        unsubscribe();
        uninstallPaste();
        editorRef.current = null;
        setMountedEditor(null);
      };
    },
    [applySnapshot, scheduleSave],
  );

  const reloadLatest = useCallback(() => {
    if (boardId) void load(boardId);
  }, [boardId, load]);

  // `/` opens the insert palette (icons tab) from anywhere except while
  // typing: text inputs, content-editables, and an in-progress shape edit all
  // keep it. Window-level so it also works when focus sits on body.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEntryTarget(e.target)) return;
      const editor = editorRef.current;
      if (!editor || editor.getEditingShapeId()) return;
      e.preventDefault();
      setPaletteTab("icons");
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "failed"
        ? "Save failed — will retry"
        : saveState === "conflict"
          ? `Not saved · rev ${meta.revision} is stale`
          : `Saved · rev ${meta.revision}`;

  return (
    <div className="flex h-full min-h-[500px] flex-col">
      <TopBar
        title={meta.title}
        saveLabel={saveLabel}
        saveState={saveState}
        docOpen={docOpen}
        onToggleDoc={() => setDocOpen((open) => !open)}
        paletteOpen={paletteOpen}
        onTogglePalette={() => setPaletteOpen((open) => !open)}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail
          editor={mountedEditor}
          paletteOpen={paletteOpen}
          paletteTab={paletteTab}
          onOpenPalette={(tab) => {
            setPaletteTab(tab);
            setPaletteOpen(true);
          }}
        />
        <IconPalette
          open={paletteOpen}
          editor={mountedEditor}
          tab={paletteTab}
          onTabChange={setPaletteTab}
          onClose={() => setPaletteOpen(false)}
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          <Tldraw
            overrides={drawUiOverrides}
            shapeUtils={ICON_SHAPE_UTILS}
            components={TLDRAW_COMPONENTS}
            onMount={onMount}
          />

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
        {docOpen && <DocPane doc={meta.doc} onChange={updateDoc} />}
      </div>
    </div>
  );
}
