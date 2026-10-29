// The live half of the canvas adapter: a thin React bridge over the Excalidraw
// component plus the imperative operations the page drives (tool, insert,
// export). Pure scene logic lives in engine.ts; this file is the only place
// that imports the Excalidraw runtime.
//
// Excalidraw's own tool palette and main menu are hidden by CSS (see
// excalidraw-overrides.css) because our rail and TopBar replace them; its
// context menu and style panel are kept.

import { useCallback, useRef, type ComponentProps } from "react";
import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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

  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    // Excalidraw restores `currentItem*` from this browser's localStorage, so a
    // profile that has seen the sketchy defaults would ignore `initialData`.
    // Re-assert the formal defaults once per mount; the values are not part of
    // the persisted snapshot, so this does not dirty the board.
    api.updateScene({ appState: FORMAL_DRAW_DEFAULTS });
    onAdapterReadyRef.current(createCanvasAdapter(api));
  }, []);

  const handleChange = useCallback(() => {
    onChangeRef.current();
  }, []);

  return (
    <div className="coredraw-canvas">
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
  api.updateScene({ elements: [...existing, ...elements] });
  const selectedElementIds: Record<string, true> = {};
  for (const el of elements) selectedElementIds[el.id] = true;
  api.updateScene({ appState: { selectedElementIds } });
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
  // Serialized form of the last scene we know matches the server, and whether
  // we have adopted the first post-mount snapshot. Excalidraw emits change
  // events for view-only churn (scroll, selection, load normalization) that a
  // user edit did not cause; comparing content keeps those from bumping the
  // board revision. Adopting the first change absorbs Excalidraw's rewrite of
  // freshly-loaded elements, so merely opening a board does not save.
  let lastSeen: string | null = null;
  let adoptBaseline = true;
  // `updateScene` can emit a synchronous change; this guard keeps the
  // pressure-flattening rewrite from re-entering itself.
  let flattening = false;

  return {
    toSnapshot: () => {
      // Never rewrite an element that is still being drawn: replacing the
      // in-progress element detaches it from Excalidraw's pointer state and the
      // stroke collapses to a dot. The change emitted on pointer-up flattens it.
      const inProgress = api.getAppState().newElement !== null;
      const elements = inProgress
        ? api.getSceneElements()
        : flattenFreehandPressure(api.getSceneElements()).elements;
      return sceneToSnapshot(elements, api.getAppState());
    },
    noteSceneChange: () => {
      const inProgress = api.getAppState().newElement !== null;
      const { elements, changed } = inProgress
        ? { elements: api.getSceneElements(), changed: false }
        : flattenFreehandPressure(api.getSceneElements());
      if (changed && !flattening) {
        flattening = true;
        api.updateScene({ elements });
        flattening = false;
      }
      const json = JSON.stringify(sceneToSnapshot(elements, api.getAppState()));
      if (adoptBaseline) {
        adoptBaseline = false;
        lastSeen = json;
        return false;
      }
      if (json === lastSeen) return false;
      lastSeen = json;
      return true;
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
      appendElements(api, built.elements);
    },
    applyStyle: (style: DrawStyle) => {
      const appState = api.getAppState();
      api.updateScene({
        elements: applyStyleToElements(api.getSceneElements(), appState.selectedElementIds ?? {}, style),
        appState: {
          currentItemStrokeColor: style.strokeColor,
          currentItemBackgroundColor: style.backgroundColor,
          currentItemStrokeWidth: style.strokeWidth,
          currentItemStrokeStyle: style.strokeStyle,
          currentItemFillStyle: style.fillStyle,
          currentItemOpacity: style.opacity,
        },
      });
    },
    currentStyle: (): DrawStyle => {
      const appState = api.getAppState();
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
    },
    insertIcon: (iconId: string) => {
      const { x, y } = viewportCenter(api);
      const { elements, file } = buildIconInsertion(iconId, x - ICON_SIZE / 2, y - ICON_SIZE / 2);
      api.addFiles([file]);
      appendElements(api, elements);
    },
    insertShape: (kind: ShapeKind) => {
      const { x, y } = viewportCenter(api);
      appendElements(api, [buildShapeElement(kind, x, y)]);
    },
    normalizeBoard: () => {
      api.updateScene({ elements: applyFormalStyle(api.getSceneElements()) });
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
