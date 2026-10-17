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
import { installJsonPasteHandler, isTextEntryTarget } from "@/pages/dashboard/draw/jsonclipboard";
import { ICON_SHAPE_UTILS } from "@/pages/dashboard/draw/icon-shape";
import { DocPane } from "@/pages/dashboard/draw/docpane";
import { drawUiOverrides } from "@/pages/dashboard/draw/shortcuts";
import { IconPalette, TopBar, ToolRail, type PaletteTab } from "@/pages/dashboard/draw/editor-ui";
import { useBoardSync, type SyncEngine } from "@/pages/dashboard/draw/sync";

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
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [paletteTab, setPaletteTab] = useState<PaletteTab>("icons");
  const [docOpen, setDocOpen] = useState(true);
  const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);

  const editorRef = useRef<Editor | null>(null);

  // The engine bridge the sync controller talks to. Stable identity so the
  // controller can hold it; the methods read the live editor through
  // editorRef, so a remount (board switch) needs no re-wiring.
  const engineRef = useRef<SyncEngine>({
    capture: () => {
      const editor = editorRef.current;
      return editor ? getSnapshot(editor.store).document : null;
    },
    apply: (snapshot) => {
      const editor = editorRef.current;
      const store = asStoreSnapshot(snapshot);
      if (editor && store) loadSnapshot(editor.store, { document: store });
    },
  });

  const sync = useBoardSync(boardId, engineRef.current);
  const { meta, updateDoc, scheduleSave, applyCurrent, reloadLatest } = sync;

  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setMountedEditor(editor);
      applyCurrent();
      const uninstallPaste = installJsonPasteHandler(editor);
      const unsubscribe = editor.store.listen(scheduleSave, { source: "user", scope: "document" });
      return () => {
        unsubscribe();
        uninstallPaste();
        editorRef.current = null;
        setMountedEditor(null);
      };
    },
    [applyCurrent, scheduleSave],
  );

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

  if (sync.phase === "loading") {
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

  if (sync.phase === "error" || !meta) {
    return (
      <div className="flex h-full min-h-[500px] items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold">Couldn't open this board</h2>
          <p className="mt-2 text-sm text-muted-foreground">{sync.loadError || "Unknown error"}</p>
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

  const { saveState, conflict } = sync;
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
                onClick={() => sync.dismissConflict()}
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
