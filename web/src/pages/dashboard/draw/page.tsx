import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ExcalidrawCanvas } from "@/pages/dashboard/draw/excalidraw-canvas";
import {
  snapshotToScene,
  toolForShortcut,
  railToolForCanvasTool,
  DEFAULT_APP_STATE,
  DEFAULT_DRAW_STYLE,
  type CanvasAdapter,
  type CanvasTool,
  type DrawStyle,
  type LoadedScene,
  type RailToolId,
  type ShapeKind,
} from "@/pages/dashboard/draw/engine";
import { DocPane } from "@/pages/dashboard/draw/docpane";
import { IconPalette, StyleBar, TopBar, ToolRail, type PaletteTab } from "@/pages/dashboard/draw/editor-ui";
import { useBoardSync, type SyncEngine } from "@/pages/dashboard/draw/sync";

function sameStyle(a: DrawStyle, b: DrawStyle): boolean {
  return (
    a.strokeColor === b.strokeColor &&
    a.backgroundColor === b.backgroundColor &&
    a.strokeWidth === b.strokeWidth &&
    a.strokeStyle === b.strokeStyle &&
    a.fillStyle === b.fillStyle &&
    a.opacity === b.opacity
  );
}

export default function DrawPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  // The insert palette starts closed; `/` is the fast path to icon search.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteTab, setPaletteTab] = useState<PaletteTab>("icons");
  // Bumped when `/` is pressed so the palette's search refocuses even when the
  // panel is already open.
  const [paletteFocusNonce, setPaletteFocusNonce] = useState(0);
  const [docOpen, setDocOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<RailToolId | null>("select");
  const [style, setStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const styleRef = useRef<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [scene, setScene] = useState<LoadedScene | null>(null);
  // Bumped on every load so the canvas remounts (Excalidraw only reads
  // initialData on mount).
  const [loadEpoch, setLoadEpoch] = useState(0);

  const adapterRef = useRef<CanvasAdapter | null>(null);

  // The engine bridge the sync controller talks to. Stable identity so the
  // controller can hold it; `capture` reads the live canvas through the
  // adapter, `apply` drops a loaded snapshot into state for the canvas to mount
  // with.
  const engineRef = useRef<SyncEngine>({
    capture: () => adapterRef.current?.toSnapshot() ?? null,
    apply: (snapshot, version) => {
      setScene(snapshotToScene(snapshot, version));
      setLoadEpoch((epoch) => epoch + 1);
    },
  });

  const sync = useBoardSync(boardId, engineRef.current);
  const { meta, updateDoc, scheduleSave, reloadLatest } = sync;

  // Only arm a save when the scene actually differs from the last known state
  // (the adapter owns that judgement; it also refreshes the rail highlight).
  const onCanvasChange = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    setActiveTool(adapter.activeRailTool());
    const next = adapter.currentStyle();
    if (!sameStyle(next, styleRef.current)) {
      styleRef.current = next;
      setStyle(next);
    }
    if (adapter.noteSceneChange()) scheduleSave();
  }, [scheduleSave]);

  // The canvas may mount after the network load resolves; keep its adapter so
  // the page can drive the canvas through it.
  const onAdapterReady = useCallback((adapter: CanvasAdapter) => {
    adapterRef.current = adapter;
  }, []);

  const handleSelectTool = useCallback((id: CanvasTool) => {
    const adapter = adapterRef.current;
    adapter?.setTool(id);
    setActiveTool(railToolForCanvasTool(id));
    if (adapter) {
      const next = adapter.currentStyle();
      styleRef.current = next;
      setStyle(next);
    }
  }, []);

  const handleStyleChange = useCallback((patch: Partial<DrawStyle>) => {
    const next = { ...styleRef.current, ...patch };
    styleRef.current = next;
    setStyle(next);
    adapterRef.current?.applyStyle(next);
  }, []);

  const handlePickIcon = useCallback((iconId: string) => {
    adapterRef.current?.insertIcon(iconId);
  }, []);

  const handlePickShape = useCallback((kind: ShapeKind) => {
    adapterRef.current?.insertShape(kind);
  }, []);

  const handlePickTemplate = useCallback((templateId: string) => {
    adapterRef.current?.insertTemplate(templateId);
  }, []);

  const handleExport = useCallback((format: "png" | "svg") => {
    void adapterRef.current?.exportImage(format);
  }, []);

  const handleNormalize = useCallback(() => {
    adapterRef.current?.normalizeBoard();
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
      handleSelectTool(tool);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [handleSelectTool]);

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
        onNormalize={handleNormalize}
      />
      <StyleBar style={style} onChange={handleStyleChange} />

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
          onPickTemplate={handlePickTemplate}
        />
        <div className="relative min-h-0 min-w-0 flex-1">
          <ExcalidrawCanvas
            key={`${meta.id}:${loadEpoch}`}
            initialScene={scene ?? { elements: [], appState: DEFAULT_APP_STATE, files: {} }}
            onAdapterReady={onAdapterReady}
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
