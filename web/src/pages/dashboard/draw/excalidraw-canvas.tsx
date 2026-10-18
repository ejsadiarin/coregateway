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
import type { ExcalidrawImperativeAPI, ToolType } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  buildIconInsertion,
  buildShapeElement,
  toExcalidrawTool,
  ICON_SIZE,
  type LoadedScene,
  type ShapeKind,
} from "@/pages/dashboard/draw/engine";
import "@/pages/dashboard/draw/excalidraw-overrides.css";

// Serve Excalidraw's fonts/locales from our own origin (Vite plugin) so the
// app never reaches for the CDN.
if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
}

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

export interface ExcalidrawCanvasProps {
  initialScene: LoadedScene;
  onApiReady: (api: ExcalidrawImperativeAPI) => void;
  onChange: () => void;
}

export function ExcalidrawCanvas({ initialScene, onApiReady, onChange }: ExcalidrawCanvasProps) {
  // Excalidraw only reads `initialData` on mount, so freeze it. The page keys
  // this component per load, so opening a different board (or reloading)
  // remounts with fresh data. This replaces imperative `updateScene`, which was
  // racy: under StrictMode the API callback and the async board fetch resolve in
  // an order that let the canvas commit an empty scene over the loaded one.
  const initialData = useRef<ComponentProps<typeof Excalidraw>["initialData"]>(initialScene).current;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onApiReadyRef = useRef(onApiReady);
  onApiReadyRef.current = onApiReady;

  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    onApiReadyRef.current(api);
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
// Imperative adapter operations (live).
// ---------------------------------------------------------------------------

function viewportCenter(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const appState = api.getAppState();
  const center = viewportCoordsToSceneCoords(
    { clientX: appState.offsetLeft + appState.width / 2, clientY: appState.offsetTop + appState.height / 2 },
    appState,
  );
  return { x: center.x, y: center.y };
}

export function setCanvasTool(api: ExcalidrawImperativeAPI, toolId: string): void {
  api.setActiveTool({ type: toExcalidrawTool(toolId) });
}

// Activate an Excalidraw tool directly (used by the eraser.io-style keyboard
// shortcuts, which include tools the rail does not carry, e.g. rectangle).
export function setCanvasToolType(api: ExcalidrawImperativeAPI, tool: ToolType): void {
  api.setActiveTool({ type: tool });
}

function appendElements(api: ExcalidrawImperativeAPI, elements: ExcalidrawElement[]): void {
  const existing = api.getSceneElements();
  api.updateScene({ elements: [...existing, ...elements] });
  const selectedElementIds: Record<string, true> = {};
  for (const el of elements) selectedElementIds[el.id] = true;
  api.updateScene({ appState: { selectedElementIds } });
}

export function insertIconOnCanvas(api: ExcalidrawImperativeAPI, iconId: string, title?: string): void {
  const { x, y } = viewportCenter(api);
  const { elements, file } = buildIconInsertion(iconId, x - ICON_SIZE / 2, y - ICON_SIZE / 2, { title });
  api.addFiles([file]);
  appendElements(api, elements);
}

export function insertShapeOnCanvas(api: ExcalidrawImperativeAPI, kind: ShapeKind): void {
  const { x, y } = viewportCenter(api);
  appendElements(api, [buildShapeElement(kind, x, y)]);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportCanvas(api: ExcalidrawImperativeAPI, format: "png" | "svg"): Promise<void> {
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
}
