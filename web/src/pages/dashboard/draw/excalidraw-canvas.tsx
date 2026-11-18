// The live half of the canvas adapter: a thin React bridge over the Excalidraw
// component plus the imperative operations the page drives (tool, insert,
// export). Pure scene logic lives in engine.ts; this file is the only place
// that imports the Excalidraw runtime.
//
// Excalidraw's own tool palette and main menu are hidden by CSS (see
// excalidraw-overrides.css) because our rail and TopBar replace them; its
// context menu and style panel are kept.

import { useCallback, useEffect, useRef, type ComponentProps } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  hashElementsVersion,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  applyStyleToElements,
  buildIconInsertion,
  buildShapeElement,
  sceneToSnapshot,
  railToolForExcalidrawTool,
  flattenFreehandPressure,
  applyFormalStyle,
  SceneEditTracker,
  sceneChangeToken,
  DEFAULT_DRAW_STYLE,
  FORMAL_DRAW_DEFAULTS,
  FREEDRAW_STROKE_WIDTH,
  TOOL_MAP,
  ICON_SIZE,
  type CanvasAdapter,
  type CanvasTool,
  type DrawStyle,
  type LoadedScene,
  type ShapeKind,
} from "@/pages/dashboard/draw/engine";
import { buildDiagramTemplate } from "@/pages/dashboard/draw/templates";
import "@/pages/dashboard/draw/excalidraw-overrides.css";
import { EXCALIDRAW_ASSETS_MOUNT } from "@/lib/excalidraw-assets";

// Serve Excalidraw's fonts/locales from our own origin (Vite plugin) so the
// app never reaches for the CDN.
if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSETS_MOUNT;
}

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

export interface ExcalidrawCanvasProps {
  initialScene: LoadedScene;
  onAdapterReady: (adapter: CanvasAdapter) => void;
  onChange: () => void;
}

// Excalidraw 0.18 swallows a single-finger touch while pen mode is on and
// disables pinch-zoom for the freedraw tool. Its intent is palm rejection, but
// the spec wants fingers to pan and pinch without drawing, so we handle touch
// pointers ourselves while pen mode is on.
function installTouchPanZoom(
  container: HTMLElement,
  apiRef: { current: ExcalidrawImperativeAPI | null },
): () => void {
  const touches = new Map<number, { x: number; y: number }>();
  let gesture:
    | {
        mode: "pan";
        startX: number;
        startY: number;
        startScrollX: number;
        startScrollY: number;
      }
    | {
        mode: "pinch";
        startDist: number;
        startMidX: number;
        startMidY: number;
        startScrollX: number;
        startScrollY: number;
        startZoom: number;
      }
    | null = null;

  const shouldHandle = (event: PointerEvent) =>
    event.pointerType === "touch" && !!apiRef.current?.getAppState().penMode;

  function beginPinch() {
    const api = apiRef.current;
    if (!api) return;
    const [a, b] = [...touches.values()];
    const appState = api.getAppState();
    gesture = {
      mode: "pinch",
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2,
      startScrollX: appState.scrollX,
      startScrollY: appState.scrollY,
      startZoom: appState.zoom.value,
    };
  }

  const onDown = (event: PointerEvent) => {
    if (!shouldHandle(event)) return;
    event.preventDefault();
    event.stopPropagation();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 1) {
      const api = apiRef.current!;
      const appState = api.getAppState();
      gesture = {
        mode: "pan",
        startX: event.clientX,
        startY: event.clientY,
        startScrollX: appState.scrollX,
        startScrollY: appState.scrollY,
      };
    } else if (touches.size === 2) {
      beginPinch();
    }
  };

  const onMove = (event: PointerEvent) => {
    if (!shouldHandle(event) || !touches.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const api = apiRef.current!;
    const appState = api.getAppState();

    if (touches.size >= 2) {
      if (gesture?.mode !== "pinch") beginPinch();
      if (gesture?.mode !== "pinch") return;
      const [a, b] = [...touches.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, gesture.startZoom * (dist / gesture.startDist)));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const sceneX = (gesture.startMidX - appState.offsetLeft - gesture.startScrollX) / gesture.startZoom;
      const sceneY = (gesture.startMidY - appState.offsetTop - gesture.startScrollY) / gesture.startZoom;
      api.updateScene({
        appState: {
          scrollX: midX - appState.offsetLeft - sceneX * zoom,
          scrollY: midY - appState.offsetTop - sceneY * zoom,
          zoom: { value: zoom } as AppState["zoom"],
        },
      });
      return;
    }

    if (gesture?.mode === "pan") {
      const point = touches.values().next().value!;
      api.updateScene({
        appState: {
          scrollX: gesture.startScrollX + (point.x - gesture.startX) / appState.zoom.value,
          scrollY: gesture.startScrollY + (point.y - gesture.startY) / appState.zoom.value,
        },
      });
    }
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    touches.delete(event.pointerId);
    if (touches.size === 1) {
      const api = apiRef.current;
      if (!api) return;
      const appState = api.getAppState();
      const point = touches.values().next().value!;
      gesture = {
        mode: "pan",
        startX: point.x,
        startY: point.y,
        startScrollX: appState.scrollX,
        startScrollY: appState.scrollY,
      };
    } else if (touches.size === 0) {
      gesture = null;
    }
  };

  container.addEventListener("pointerdown", onDown, { capture: true });
  container.addEventListener("pointermove", onMove, { capture: true });
  container.addEventListener("pointerup", onUp, { capture: true });
  container.addEventListener("pointercancel", onUp, { capture: true });
  return () => {
    container.removeEventListener("pointerdown", onDown, { capture: true });
    container.removeEventListener("pointermove", onMove, { capture: true });
    container.removeEventListener("pointerup", onUp, { capture: true });
    container.removeEventListener("pointercancel", onUp, { capture: true });
  };
}

export function ExcalidrawCanvas({ initialScene, onAdapterReady, onChange }: ExcalidrawCanvasProps) {
  // Excalidraw only reads `initialData` on mount, so freeze it. The page keys
  // this component per load, so opening a different board (or reloading)
  // remounts with fresh data. This replaces imperative `updateScene`, which was
  // racy: under StrictMode the API callback and the async board fetch resolve in
  // an order that let the canvas commit an empty scene over the loaded one.
  const initialData = useRef<ComponentProps<typeof Excalidraw>["initialData"]>({
    ...initialScene,
    appState: { ...initialScene.appState, ...FORMAL_DRAW_DEFAULTS },
  }).current;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onAdapterReadyRef = useRef(onAdapterReady);
  onAdapterReadyRef.current = onAdapterReady;
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    // Excalidraw restores `currentItem*` from this browser's localStorage, so a
    // profile that has seen the sketchy defaults would ignore `initialData`.
    // Re-assert the formal defaults once per mount; the values are not part of
    // the persisted snapshot, so this does not dirty the board.
    apiRef.current = api;
    api.updateScene({ appState: FORMAL_DRAW_DEFAULTS });
    onAdapterReadyRef.current(createCanvasAdapter(api));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installTouchPanZoom(container, apiRef);
  }, []);

  const handleChange = useCallback(() => {
    onChangeRef.current();
  }, []);

  return (
    <div ref={containerRef} className="coredraw-canvas">
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={handleApiReady}
        onChange={handleChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The live adapter: binds the imperative Excalidraw API into the page-facing
// CanvasAdapter interface. This is the only module that touches the runtime.
// ---------------------------------------------------------------------------

function viewportCenter(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const appState = api.getAppState();
  const center = viewportCoordsToSceneCoords(
    { clientX: appState.offsetLeft + appState.width / 2, clientY: appState.offsetTop + appState.height / 2 },
    appState,
  );
  return { x: center.x, y: center.y };
}

function appendElements(api: ExcalidrawImperativeAPI, elements: ExcalidrawElement[]): void {
  const existing = api.getSceneElements();
  api.updateScene({
    elements: [...existing, ...elements],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  const selectedElementIds: Record<string, true> = {};
  for (const el of elements) selectedElementIds[el.id] = true;
  api.updateScene({ appState: { selectedElementIds } });
}

function currentStyleFrom(appState: ReturnType<ExcalidrawImperativeAPI["getAppState"]>): DrawStyle {
  return {
    strokeColor: appState.currentItemStrokeColor ?? DEFAULT_DRAW_STYLE.strokeColor,
    backgroundColor: appState.currentItemBackgroundColor ?? DEFAULT_DRAW_STYLE.backgroundColor,
    strokeWidth: appState.currentItemStrokeWidth ?? DEFAULT_DRAW_STYLE.strokeWidth,
    strokeStyle: (appState.currentItemStrokeStyle ??
      DEFAULT_DRAW_STYLE.strokeStyle) as DrawStyle["strokeStyle"],
    fillStyle: (appState.currentItemFillStyle ??
      DEFAULT_DRAW_STYLE.fillStyle) as DrawStyle["fillStyle"],
    opacity: appState.currentItemOpacity ?? DEFAULT_DRAW_STYLE.opacity,
  };
}

// New elements built by the palette use the same style as a freshly drawn one.
function styleNewElements(elements: ExcalidrawElement[], style: DrawStyle): ExcalidrawElement[] {
  const selected: Record<string, true> = {};
  for (const el of elements) selected[el.id] = true;
  return applyStyleToElements(elements, selected, style);
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 30;
const ZOOM_STEP = 1.1;

// Keep the scene point at the viewport centre fixed while zooming (the same
// formula as Excalidraw's own zoom actions), so the drawing does not drift.
function setZoom(api: ExcalidrawImperativeAPI, value: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  const appState = api.getAppState();
  const currentZoom = appState.zoom.value;
  const layerX = appState.width / 2;
  const layerY = appState.height / 2;
  const scrollX =
    appState.scrollX + (layerX - layerX / currentZoom) - (layerX - layerX / clamped);
  const scrollY =
    appState.scrollY + (layerY - layerY / currentZoom) - (layerY - layerY / clamped);
  api.updateScene({
    appState: { scrollX, scrollY, zoom: { value: clamped } as AppState["zoom"] },
  });
}

// Excalidraw's own footer carries the canonical undo/redo buttons, including
// their disabled state. We hide that footer visually but drive the same
// actions, so history semantics (style changes, moves, deletes) stay exact.
function historyButton(testId: "button-undo" | "button-redo"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function createCanvasAdapter(api: ExcalidrawImperativeAPI): CanvasAdapter {
  // A cheap id/version hash of the last scene we saw. Excalidraw emits change
  // events for view-only churn (pan, zoom, selection, load normalization) that
  // a user edit did not cause; comparing the hash keeps those from bumping the
  // board revision. The first change adopts a baseline, absorbing Excalidraw's
  // rewrite of freshly-loaded elements so merely opening a board does not save.
  const tracker = new SceneEditTracker();
  // `updateScene` can emit a synchronous change; this guard keeps the
  // pressure-flattening rewrite from re-entering itself.
  let flattening = false;

  return {
    toSnapshot: () => {
      // Never read or rewrite the scene while a stroke is in progress: a save
      // timer armed by the previous edit must not persist a partial stroke, and
      // replacing the in-progress element would collapse it to a dot. The
      // pointer-up change schedules the save that includes the whole stroke.
      if (api.getAppState().newElement !== null) return null;
      return sceneToSnapshot(flattenFreehandPressure(api.getSceneElements()).elements, api.getAppState());
    },
    noteSceneChange: () => {
      // Mid-stroke every pointer move emits a change. Do nothing scene-wide
      // until pointer-up: the change that ends the stroke does the work once.
      if (flattening || api.getAppState().newElement !== null) return false;

      const elements = api.getSceneElements();
      const token = sceneChangeToken(hashElementsVersion(elements), api.getAppState());
      const result = tracker.observe(token);
      if (result === "unchanged") return false;

      // A real edit (or the first post-mount change): normalize simulated
      // pressure, then adopt the bumped version so the rewrite is not counted
      // as another edit.
      const flattened = flattenFreehandPressure(elements);
      if (flattened.changed) {
        flattening = true;
        api.updateScene({ elements: flattened.elements });
        flattening = false;
        tracker.adopt(sceneChangeToken(hashElementsVersion(flattened.elements), api.getAppState()));
      }
      return result === "changed";
    },
    activeRailTool: () => railToolForExcalidrawTool(api.getAppState().activeTool?.type ?? ""),
    setTool: (tool: CanvasTool) => {
      api.setActiveTool({ type: TOOL_MAP[tool] });
      // Draw mode defaults to the thin pen; other tools keep whatever width the
      // style bar last set.
      if (tool === "draw") {
        api.updateScene({ appState: { currentItemStrokeWidth: FREEDRAW_STROKE_WIDTH } });
      }
    },
    insertTemplate: (templateId: string) => {
      const { x, y } = viewportCenter(api);
      const built = buildDiagramTemplate(templateId, x, y);
      if (!built) return;
      api.addFiles(Object.values(built.files));
      appendElements(api, styleNewElements(built.elements, currentStyleFrom(api.getAppState())));
    },
    applyStyle: (style: DrawStyle) => {
      const appState = api.getAppState();
      const current = api.getSceneElements();
      const next = applyStyleToElements(current, appState.selectedElementIds ?? {}, style);
      const changed = next.some((el, index) => el !== current[index]);
      api.updateScene({
        elements: next,
        appState: {
          currentItemStrokeColor: style.strokeColor,
          currentItemBackgroundColor: style.backgroundColor,
          currentItemStrokeWidth: style.strokeWidth,
          currentItemStrokeStyle: style.strokeStyle,
          currentItemFillStyle: style.fillStyle,
          currentItemOpacity: style.opacity,
        },
        // A default colour with nothing selected is not a scene edit.
        captureUpdate: changed ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      });
    },
    currentStyle: (): DrawStyle => currentStyleFrom(api.getAppState()),
    historyState: () => {
      const undo = historyButton("button-undo");
      const redo = historyButton("button-redo");
      return { undo: !!undo && !undo.disabled, redo: !!redo && !redo.disabled };
    },
    undo: () => historyButton("button-undo")?.click(),
    redo: () => historyButton("button-redo")?.click(),
    penState: () => {
      const appState = api.getAppState();
      return { detected: !!appState.penDetected, active: !!appState.penMode };
    },
    setPenMode: (active: boolean) => {
      api.updateScene({ appState: { penMode: active } });
    },
    currentZoom: () => api.getAppState().zoom.value,
    zoomIn: () => setZoom(api, api.getAppState().zoom.value * ZOOM_STEP),
    zoomOut: () => setZoom(api, api.getAppState().zoom.value / ZOOM_STEP),
    resetZoom: () => setZoom(api, 1),
    zoomToFit: () => {
      const elements = api.getSceneElements();
      if (elements.length === 0) {
        api.updateScene({ appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } as AppState["zoom"] } });
        return;
      }
      api.scrollToContent(elements, { fitToContent: true });
    },
    insertIcon: (iconId: string) => {
      const { x, y } = viewportCenter(api);
      const { elements, file } = buildIconInsertion(iconId, x - ICON_SIZE / 2, y - ICON_SIZE / 2);
      api.addFiles([file]);
      appendElements(api, styleNewElements(elements, currentStyleFrom(api.getAppState())));
    },
    insertShape: (kind: ShapeKind) => {
      const { x, y } = viewportCenter(api);
      const shape = buildShapeElement(kind, x, y);
      appendElements(api, styleNewElements([shape], currentStyleFrom(api.getAppState())));
    },
    normalizeBoard: () => {
      const current = api.getSceneElements();
      const next = applyFormalStyle(current);
      const changed = next.some((el, index) => el !== current[index]);
      api.updateScene({
        elements: next,
        captureUpdate: changed ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      });
    },
    exportImage: async (format: "png" | "svg") => {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      if (format === "png") {
        const blob = await exportToBlob({ elements, appState, files, mimeType: "image/png" });
        download(blob, "board.png");
      } else {
        const svg = await exportToSvg({ elements, appState, files });
        download(new Blob([svg.outerHTML], { type: "image/svg+xml" }), "board.svg");
      }
    },
  };
}
