// The canvas adapter — the single new seam of the Excalidraw migration.
//
// Everything Excalidraw-specific lives behind this module: the page, rail and
// palette talk only to these operations, never to `@excalidraw/excalidraw`.
// The core is pure functions over plain element arrays so it can be unit
// tested with no browser; the React canvas (excalidraw-canvas.tsx) is a thin
// imperative bridge on top.
//
// Notes carried over from the design:
// - Excalidraw keeps image bytes in a separate `files` map, not in the
//   elements. The snapshot stores elements only; icon data-URLs are rebuilt
//   from the vendored sprite on load, so a board row never carries image bytes.
// - `snapshot_version` gates the format: anything but `SNAPSHOT_VERSION` loads
//   as a blank canvas (existing tldraw boards are discarded, not converted).

import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ToolType,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import { iconSprite, iconTitle } from "@/pages/dashboard/draw/icon-catalog";

// The scene schema this adapter writes. Bumping it invalidates every stored
// board (they load blank) — that is the migration's reset, by design.
export const SNAPSHOT_VERSION = 2;

// Icon glyph + label geometry. Glyph is square; the label sits under it with a
// small gap, the pair acting as one unit.
export const ICON_SIZE = 96;
export const LABEL_GAP = 6;
export const LABEL_HEIGHT = 24;

// Excalidraw's "Normal" text style: Helvetica family, medium size.
const NORMAL_FONT_FAMILY = 2;
const MEDIUM_FONT_SIZE = 20;

// Only durable view config is persisted; scroll/zoom/selection/zen are
// reconstructed per session.
export interface DurableAppState {
  viewBackgroundColor: string;
  gridSize: number;
  gridModeEnabled: boolean;
}

export const DEFAULT_APP_STATE: DurableAppState = {
  viewBackgroundColor: "#ffffff",
  gridSize: 20,
  gridModeEnabled: false,
};

export interface SceneSnapshot {
  version: number;
  elements: ExcalidrawElement[];
  appState: DurableAppState;
}

export interface LoadedScene {
  elements: ExcalidrawElement[];
  appState: DurableAppState;
  files: BinaryFiles;
}

// ---------------------------------------------------------------------------
// Small identity/random helpers (kept local so the module never imports the
// Excalidraw runtime, and stays deterministic-friendly for tests).
// ---------------------------------------------------------------------------

let counter = 0;

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function randomInt(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

// ---------------------------------------------------------------------------
// Icon glyph → SVG data-URL (from the vendored sprite).
// ---------------------------------------------------------------------------

// Monochrome families (mdi) rely on `currentColor`, which has no meaning in a
// standalone SVG image; pin a dark ink so they read on the default light board.
const MONO_INK = "#1e1e1e";

export function spriteToDataUrl(iconId: string): string {
  const { viewBox, body } = iconSprite(iconId);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" ` +
    `style="color:${MONO_INK}">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// Element factories.
// ---------------------------------------------------------------------------

interface BaseFields {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupIds?: string[];
  customData?: Record<string, unknown>;
}

function base(f: BaseFields) {
  return {
    id: f.id ?? randomId(),
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    angle: 0,
    strokeColor: MONO_INK,
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    index: null,
    isDeleted: false,
    groupIds: f.groupIds ?? [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: f.customData,
  };
}

// The file id used for every placement of one icon, so all Lambda glyphs share
// a single uploaded file. Deterministic, so re-hydration can rebuild the file.
export function iconFileId(iconId: string): string {
  return `icon:${iconId}`;
}

export interface IconInsertion {
  // [imageElement, textLabel]
  elements: ExcalidrawElement[];
  file: BinaryFileData;
}

// Build the image + editable-label pair for an icon, sharing a group so they
// select/move/delete as one (and can be ungrouped to edit independently).
export function buildIconInsertion(
  iconId: string,
  x: number,
  y: number,
  opts: { title?: string; fileId?: string } = {},
): IconInsertion {
  const title = opts.title ?? iconTitle(iconId);
  const groupId = randomId();
  const fileId = opts.fileId ?? iconFileId(iconId);

  const image = {
    ...base({
      x,
      y,
      width: ICON_SIZE,
      height: ICON_SIZE,
      groupIds: [groupId],
      customData: { iconId },
    }),
    type: "image" as const,
    fileId,
    status: "saved" as const,
    scale: [1, 1],
    crop: null,
  } as unknown as ExcalidrawImageElement;

  const label = {
    ...base({
      x,
      y: y + ICON_SIZE + LABEL_GAP,
      width: ICON_SIZE,
      height: LABEL_HEIGHT,
      groupIds: [groupId],
    }),
    type: "text" as const,
    fontSize: MEDIUM_FONT_SIZE,
    fontFamily: NORMAL_FONT_FAMILY,
    text: title,
    originalText: title,
    textAlign: "center" as const,
    verticalAlign: "top" as const,
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  } as unknown as ExcalidrawTextElement;

  const file = {
    id: fileId,
    mimeType: "image/svg+xml" as const,
    dataURL: spriteToDataUrl(iconId),
    created: 0,
  } as unknown as BinaryFileData;

  return { elements: [image, label], file };
}

export type ShapeKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line"
  | "text"
  | "frame";

const SHAPE_BOX: Record<"rectangle" | "ellipse" | "diamond", { w: number; h: number }> = {
  rectangle: { w: 160, h: 100 },
  ellipse: { w: 160, h: 100 },
  diamond: { w: 140, h: 140 },
};

// One native Excalidraw element of the given kind, placed at (x, y).
export function buildShapeElement(kind: ShapeKind, x: number, y: number): ExcalidrawElement {
  if (kind === "rectangle" || kind === "ellipse" || kind === "diamond") {
    const { w, h } = SHAPE_BOX[kind];
    return {
      ...base({ x, y, width: w, height: h }),
      type: kind,
      roundness: kind === "rectangle" ? { type: 3 } : null,
    } as unknown as ExcalidrawElement;
  }
  if (kind === "text") {
    return {
      ...base({ x, y, width: 120, height: 25 }),
      type: "text",
      fontSize: MEDIUM_FONT_SIZE,
      fontFamily: NORMAL_FONT_FAMILY,
      text: "Text",
      originalText: "Text",
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
    } as unknown as ExcalidrawTextElement;
  }
  if (kind === "arrow" || kind === "line") {
    const points: [number, number][] = [
      [0, 0],
      [200, 0],
    ];
    return {
      ...base({ x, y, width: 200, height: 0 }),
      type: kind,
      points,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: kind === "arrow" ? "arrow" : null,
      roundness: { type: 2 },
    } as unknown as ExcalidrawLinearElement;
  }
  // frame
  return {
    ...base({ x, y, width: 320, height: 220 }),
    type: "frame",
    name: null,
  } as unknown as ExcalidrawElement;
}

// ---------------------------------------------------------------------------
// Snapshot ↔ scene.
// ---------------------------------------------------------------------------

function pickDurableAppState(appState: Partial<AppState>): DurableAppState {
  return {
    viewBackgroundColor: appState.viewBackgroundColor ?? DEFAULT_APP_STATE.viewBackgroundColor,
    gridSize: appState.gridSize ?? DEFAULT_APP_STATE.gridSize,
    gridModeEnabled: appState.gridModeEnabled ?? false,
  };
}

export function sceneToSnapshot(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
): SceneSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    elements: elements.filter((el) => !el.isDeleted),
    appState: pickDurableAppState(appState),
  };
}

// Rebuild the `files` map for icon images from the vendored sprite, keyed by
// the element's fileId. Never persisted; regenerated on every load.
export function hydrateIconFiles(elements: readonly ExcalidrawElement[]): BinaryFiles {
  const files: BinaryFiles = {};
  for (const el of elements) {
    if (el.type !== "image") continue;
    const image = el as ExcalidrawImageElement;
    const iconId = (image.customData as { iconId?: string } | undefined)?.iconId;
    if (!iconId || !image.fileId) continue;
    if (files[image.fileId]) continue;
    files[image.fileId] = {
      id: image.fileId,
      mimeType: "image/svg+xml",
      dataURL: spriteToDataUrl(iconId),
      created: 0,
    } as unknown as BinaryFileData;
  }
  return files;
}

function asSceneSnapshot(raw: unknown): SceneSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { version?: unknown; elements?: unknown; appState?: unknown };
  if (s.version !== SNAPSHOT_VERSION) return null;
  if (!Array.isArray(s.elements)) return null;
  const appState = (s.appState ?? {}) as Partial<DurableAppState>;
  return {
    version: SNAPSHOT_VERSION,
    elements: s.elements as ExcalidrawElement[],
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor ?? DEFAULT_APP_STATE.viewBackgroundColor,
      gridSize: appState.gridSize ?? DEFAULT_APP_STATE.gridSize,
      gridModeEnabled: appState.gridModeEnabled ?? false,
    },
  };
}

// Load an opaque snapshot into a scene. An unknown/old version (or a fresh
// board's `{}`) yields a blank canvas rather than an error.
export function snapshotToScene(raw: unknown): LoadedScene {
  const snap = asSceneSnapshot(raw);
  if (!snap) {
    return { elements: [], appState: { ...DEFAULT_APP_STATE }, files: {} };
  }
  return {
    elements: snap.elements,
    appState: { ...snap.appState },
    files: hydrateIconFiles(snap.elements),
  };
}

// ---------------------------------------------------------------------------
// Tools.
// ---------------------------------------------------------------------------

// The rail's tool ids. Excalidraw 0.18 has no lasso tool, so the rail offers
// exactly these; `toExcalidrawTool` falls back to selection for anything else.
export type RailToolId =
  | "select"
  | "hand"
  | "draw"
  | "eraser"
  | "text"
  | "arrow"
  | "line"
  | "frame";

export const TOOL_MAP: Record<RailToolId, ToolType> = {
  select: "selection",
  hand: "hand",
  draw: "freedraw",
  eraser: "eraser",
  text: "text",
  arrow: "arrow",
  line: "line",
  frame: "frame",
};

export function toExcalidrawTool(id: string): ToolType {
  return (TOOL_MAP as Record<string, ToolType | undefined>)[id] ?? "selection";
}
