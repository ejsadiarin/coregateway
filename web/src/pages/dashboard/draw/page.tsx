import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  ExcalidrawCanvas,
  exportCanvas,
  insertIconOnCanvas,
  insertShapeOnCanvas,
  setCanvasTool,
  setCanvasToolType,
} from "@/pages/dashboard/draw/excalidraw-canvas";
import {
  sceneToSnapshot,
  snapshotToScene,
  railToolForExcalidrawTool,
  toolForShortcut,
  DEFAULT_APP_STATE,
  type LoadedScene,
  type RailToolId,
  type ShapeKind,
} from "@/pages/dashboard/draw/engine";
import { DocPane } from "@/pages/dashboard/draw/docpane";
import { IconPalette, TopBar, ToolRail, type PaletteTab } from "@/pages/dashboard/draw/editor-ui";
import { useBoardSync, type SyncEngine } from "@/pages/dashboard/draw/sync";

export default function DrawPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [paletteTab, setPaletteTab] = useState<PaletteTab>("icons");
  // Bumped when `/` is pressed so the palette's search refocuses even when the
  // panel is already open.
  const [paletteFocusNonce, setPaletteFocusNonce] = useState(0);
  const [docOpen, setDocOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<RailToolId | null>("select");
  const [scene, setScene] = useState<LoadedScene | null>(null);
  // Bumped on every load so the canvas remounts (Excalidraw only reads
  // initialData on mount).
  const [loadEpoch, setLoadEpoch] = useState(0);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // Serialized form of the last scene we know matches the server. Excalidraw
  // emits change events for view-only churn (scroll, selection, load
  // normalization) that a user edit did not cause; comparing content keeps
  // those from bumping the board revision on every open.
  const lastSeenRef = useRef<string | null>(null);
  // Excalidraw normalizes elements as it loads them, so the first change event
  // after a mount reports the same logical scene with different bytes. Adopt
  // that as the baseline rather than saving it, so merely opening a board does
  // not bump its revision (and trip the conflict guard for anyone else).
  const adoptBaselineRef = useRef(false);

  // The engine bridge the sync controller talks to. Stable identity so the
  // controller can hold it; `capture` reads the live canvas through apiRef,
  // `apply` drops a loaded snapshot into state for the canvas to mount with.
  const engineRef = useRef<SyncEngine>({
    capture: () => {
      const api = apiRef.current;
      return api ? sceneToSnapshot(api.getSceneElements(), api.getAppState()) : null;
    },
    apply: (snapshot) => {
      const next = snapshotToScene(snapshot);
      lastSeenRef.current = JSON.stringify(sceneToSnapshot(next.elements, next.appState));
      adoptBaselineRef.current = true;
      setScene(next);
      setLoadEpoch((epoch) => epoch + 1);
    },
  });

  const sync = useBoardSync(boardId, engineRef.current);
  const { meta, updateDoc, scheduleSave, reloadLatest } = sync;

  // Only arm a save when the scene actually differs from the last known state.
  const onCanvasChange = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const appState = api.getAppState();
    const rail = railToolForExcalidrawTool(appState.activeTool?.type ?? "");
    setActiveTool(rail);
    const json = JSON.stringify(sceneToSnapshot(api.getSceneElements(), appState));
    if (adoptBaselineRef.current) {
      adoptBaselineRef.current = false;
      lastSeenRef.current = json;
      return;
    }
    if (json === lastSeenRef.current) return;
    lastSeenRef.current = json;
    scheduleSave();
  }, [scheduleSave]);

  // The canvas may mount after the network load resolves; record its API so
  // `capture` can read the live scene.
  const onApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  const handleSelectTool = useCallback((id: RailToolId) => {
    const api = apiRef.current;
    if (!api) return;
    setCanvasTool(api, id);
    setActiveTool(id);
  }, []);

  const handlePickIcon = useCallback((iconId: string, title: string) => {
    const api = apiRef.current;
    if (api) insertIconOnCanvas(api, iconId, title);
  }, []);

  const handlePickShape = useCallback((kind: ShapeKind) => {
    const api = apiRef.current;
    if (api) insertShapeOnCanvas(api, kind);
  }, []);

  const handleExport = useCallback((format: "png" | "svg") => {
    const api = apiRef.current;
    if (api) void exportCanvas(api, format);
  }, []);

  // eraser.io-style keyboard: `/` opens icon search, and bare tool keys
  // (v/h/d/e/t/r/o/a/l/f) select the matching tool. Bound on the window in the
  // capture phase so it preempts Excalidraw's own document-capture handler —
  // Excalidraw binds `d` to the diamond, we want it to draw.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      if (e.key === "/") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteTab("icons");
        setPaletteOpen(true);
        setPaletteFocusNonce((n) => n + 1);
        return;
      }

      if (e.shiftKey) return;
      const tool = toolForShortcut(e.key);
      if (!tool) return;
      e.preventDefault();
      e.stopPropagation();
      const api = apiRef.current;
      if (!api) return;
      setCanvasToolType(api, tool);
      setActiveTool(railToolForExcalidrawTool(tool));
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
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
        onExport={handleExport}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail
          activeTool={activeTool}
          onSelectTool={handleSelectTool}
          paletteOpen={paletteOpen}
          paletteTab={paletteTab}
          onOpenPalette={(tab) => {
            setPaletteTab(tab);
            setPaletteOpen(true);
          }}
        />
        <IconPalette
          open={paletteOpen}
          tab={paletteTab}
          focusNonce={paletteFocusNonce}
          onTabChange={setPaletteTab}
          onClose={() => setPaletteOpen(false)}
          onPickIcon={handlePickIcon}
          onPickShape={handlePickShape}
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          <ExcalidrawCanvas
            key={`${meta.id}:${loadEpoch}`}
            initialScene={scene ?? { elements: [], appState: DEFAULT_APP_STATE, files: {} }}
            onApiReady={onApiReady}
            onChange={onCanvasChange}
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
