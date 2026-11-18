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
import { DrawSheet } from "@/pages/dashboard/draw/draw-sheet";
import {
  HistoryZoomControls,
  IconPalette,
  MobileToolbar,
  StyleBar,
  StyleSheet,
  TopBar,
  ToolRail,
  type PaletteTab,
} from "@/pages/dashboard/draw/editor-ui";
import { usePageTitle } from "@/components/layout/page-title";
import { useIsPhone } from "@/hooks/use-is-phone";
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
  // panel is already open. A phone tap opens the palette without focusing.
  const [paletteFocusNonce, setPaletteFocusNonce] = useState(0);
  const [paletteAutoFocus, setPaletteAutoFocus] = useState(true);
  // Phones open with the notes pane closed so the canvas gets the screen, and
  // close it again if the viewport shrinks to phone width while it is open.
  const isPhone = useIsPhone();
  const [docOpen, setDocOpen] = useState(() => !isPhone);
  const [styleOpen, setStyleOpen] = useState(false);
  useEffect(() => {
    if (!isPhone) return;
    setDocOpen(false);
    setStyleOpen(false);
  }, [isPhone]);

  // Phones show at most one panel as a bottom sheet over the canvas.
  const openPhoneSheet = useCallback((sheet: "palette" | "style" | "notes" | null) => {
    setPaletteOpen(sheet === "palette");
    setStyleOpen(sheet === "style");
    setDocOpen(sheet === "notes");
  }, []);
  const [activeTool, setActiveTool] = useState<RailToolId | null>("select");
  const activeToolRef = useRef<RailToolId | null>("select");
  const [style, setStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const styleRef = useRef<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [scene, setScene] = useState<LoadedScene | null>(null);
  // Bumped on every load so the canvas remounts (Excalidraw only reads
  // initialData on mount).
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const historyRef = useRef(history);

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
  usePageTitle(meta?.title);

  // Only arm a save when the scene actually differs from the last known state
  // (the adapter owns that judgement; it also refreshes the rail highlight).
  const syncHistory = useCallback(() => {
    const next = adapterRef.current?.historyState();
    if (!next) return;
    if (next.undo !== historyRef.current.undo || next.redo !== historyRef.current.redo) {
      historyRef.current = next;
      setHistory(next);
    }
  }, []);

  // Excalidraw updates its footer buttons during the same change tick, so the
  // first read still sees the old disabled state. Re-read after the commit.
  const queueHistorySync = useCallback(() => {
    syncHistory();
    requestAnimationFrame(syncHistory);
  }, [syncHistory]);

  const onCanvasChange = useCallback(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    // Change events also fire for pan/zoom/selection and every pointer move.
    // Only touch React state when the tool, style or zoom really moved.
    const tool = adapter.activeRailTool();
    if (tool !== activeToolRef.current) {
      activeToolRef.current = tool;
      setActiveTool(tool);
    }
    const next = adapter.currentStyle();
    if (!sameStyle(next, styleRef.current)) {
      styleRef.current = next;
      setStyle(next);
    }
    const nextZoom = adapter.currentZoom();
    if (nextZoom !== zoomRef.current) {
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    }
    if (adapter.noteSceneChange()) {
      queueHistorySync();
      scheduleSave();
    }
  }, [scheduleSave, queueHistorySync]);

  // The canvas may mount after the network load resolves; keep its adapter so
  // the page can drive the canvas through it.
  const onAdapterReady = useCallback((adapter: CanvasAdapter) => {
    adapterRef.current = adapter;
    const nextHistory = adapter.historyState();
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    const nextZoom = adapter.currentZoom();
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  }, []);

  const handleSelectTool = useCallback((id: CanvasTool) => {
    const adapter = adapterRef.current;
    adapter?.setTool(id);
    const railTool = railToolForCanvasTool(id);
    activeToolRef.current = railTool;
    setActiveTool(railTool);
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

  // Inserting from the phone palette closes the sheet so the owner sees the
  // element land on the canvas. The desktop palette stays open for repeat use.
  const closePhonePalette = useCallback(() => {
    if (isPhone) setPaletteOpen(false);
  }, [isPhone]);

  const handlePickIcon = useCallback(
    (iconId: string) => {
      adapterRef.current?.insertIcon(iconId);
      closePhonePalette();
    },
    [closePhonePalette],
  );

  const handlePickShape = useCallback(
    (kind: ShapeKind) => {
      adapterRef.current?.insertShape(kind);
      closePhonePalette();
    },
    [closePhonePalette],
  );

  const handlePickTemplate = useCallback(
    (templateId: string) => {
      adapterRef.current?.insertTemplate(templateId);
      closePhonePalette();
    },
    [closePhonePalette],
  );

  const handleExport = useCallback((format: "png" | "svg") => {
    void adapterRef.current?.exportImage(format);
  }, []);

  const handleNormalize = useCallback(() => {
    adapterRef.current?.normalizeBoard();
  }, []);

  const syncZoom = useCallback(() => {
    const next = adapterRef.current?.currentZoom();
    if (next === undefined) return;
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const handleUndo = useCallback(() => {
    adapterRef.current?.undo();
    queueHistorySync();
  }, [queueHistorySync]);

  const handleRedo = useCallback(() => {
    adapterRef.current?.redo();
    queueHistorySync();
  }, [queueHistorySync]);

  const handleZoomIn = useCallback(() => {
    adapterRef.current?.zoomIn();
    syncZoom();
  }, [syncZoom]);

  const handleZoomOut = useCallback(() => {
    adapterRef.current?.zoomOut();
    syncZoom();
  }, [syncZoom]);

  const handleResetZoom = useCallback(() => {
    adapterRef.current?.resetZoom();
    syncZoom();
  }, [syncZoom]);

  const handleZoomToFit = useCallback(() => {
    adapterRef.current?.zoomToFit();
    syncZoom();
  }, [syncZoom]);

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
        setPaletteAutoFocus(true);
        if (isPhone) openPhoneSheet("palette");
        else setPaletteOpen(true);
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
  }, [handleSelectTool, isPhone, openPhoneSheet]);

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

  const paletteProps = {
    open: paletteOpen,
    tab: paletteTab,
    focusNonce: paletteFocusNonce,
    focusOnOpen: paletteAutoFocus,
    onTabChange: setPaletteTab,
    onClose: () => setPaletteOpen(false),
    onPickIcon: handlePickIcon,
    onPickShape: handlePickShape,
    onPickTemplate: handlePickTemplate,
  };

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
    <div
      data-draw-editor
      className="flex h-full min-h-0 flex-col max-md:touch-manipulation max-md:overscroll-none md:min-h-[500px]"
    >
      <TopBar
        title={meta.title}
        saveLabel={saveLabel}
        saveState={saveState}
        docOpen={docOpen}
        onToggleDoc={() => {
          if (isPhone) openPhoneSheet(docOpen ? null : "notes");
          else setDocOpen((open) => !open);
        }}
        paletteOpen={paletteOpen}
        onTogglePalette={() => {
          setPaletteAutoFocus(true);
          setPaletteOpen((open) => !open);
        }}
        onExport={handleExport}
        onNormalize={handleNormalize}
      />
      {!isPhone && <StyleBar style={style} onChange={handleStyleChange} />}

      <div className="flex min-h-0 flex-1">
        <ToolRail
          activeTool={activeTool}
          onSelectTool={handleSelectTool}
          paletteOpen={paletteOpen}
          paletteTab={paletteTab}
          onOpenPalette={(tab) => {
            setPaletteTab(tab);
            setPaletteAutoFocus(true);
            if (isPhone) openPhoneSheet("palette");
            else setPaletteOpen(true);
          }}
        />
        {!isPhone && <IconPalette {...paletteProps} />}
        <div className="relative min-h-0 min-w-0 flex-1">
          <ExcalidrawCanvas
            key={`${meta.id}:${loadEpoch}`}
            initialScene={scene ?? { elements: [], appState: DEFAULT_APP_STATE, files: {} }}
            onAdapterReady={onAdapterReady}
            onChange={onCanvasChange}
          />

          <HistoryZoomControls
            canUndo={history.undo}
            canRedo={history.redo}
            zoom={zoom}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
            onZoomToFit={handleZoomToFit}
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
        {!isPhone && docOpen && <DocPane doc={meta.doc} onChange={updateDoc} />}
      </div>
      <MobileToolbar
        activeTool={activeTool}
        onSelectTool={handleSelectTool}
        paletteOpen={paletteOpen}
        onTogglePalette={() => {
          setPaletteAutoFocus(false);
          openPhoneSheet(paletteOpen ? null : "palette");
        }}
        styleOpen={styleOpen}
        styleColor={style.strokeColor}
        onOpenStyle={() => openPhoneSheet(styleOpen ? null : "style")}
        canUndo={history.undo}
        canRedo={history.redo}
        zoom={zoom}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onZoomToFit={handleZoomToFit}
      />

      {isPhone && (
        <>
          <DrawSheet
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            title="Insert"
            description="Search and insert icons, shapes and templates."
            className="h-[78dvh]"
          >
            <IconPalette {...paletteProps} sheet />
          </DrawSheet>
          <DrawSheet
            open={styleOpen}
            onOpenChange={setStyleOpen}
            title="Style"
            description="Stroke, fill and opacity for selected and new elements."
          >
            <StyleSheet style={style} onChange={handleStyleChange} />
          </DrawSheet>
          <DrawSheet
            open={docOpen}
            onOpenChange={setDocOpen}
            title="Board notes"
            description="Board notes in markdown."
            className="h-[78dvh]"
          >
            <DocPane sheet doc={meta.doc} onChange={updateDoc} />
          </DrawSheet>
        </>
      )}
    </div>
  );
}
