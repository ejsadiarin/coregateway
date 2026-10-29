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
// - The board's `snapshot_version` column gates the format: anything but
//   `SNAPSHOT_VERSION` loads as a blank canvas (existing tldraw boards are
//   discarded, not converted).

import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ToolType,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawImageElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import { iconLabel, iconSprite } from "@/pages/dashboard/draw/icon-catalog";
import { SNAPSHOT_VERSION } from "@/lib/snapshot-version";

// The scene schema this adapter writes. Defined once in lib/snapshot-version so
// the board API client and this adapter can never disagree on the version.
export { SNAPSHOT_VERSION };

// Icon glyph + label geometry. Glyph is square; the label sits under it with a
// small gap, the pair acting as one unit.
export const ICON_SIZE = 96;
export const LABEL_GAP = 6;
export const LABEL_HEIGHT = 24;

// Excalidraw's "Code" text style: Cascadia Mono. A whiteboard reads as a tool,
// not a sketchbook, so mono is the default for every new label.
const MONO_FONT_FAMILY = 3;
const MEDIUM_FONT_SIZE = 20;

// Monochrome families (mdi) rely on `currentColor`, which has no meaning in a
// standalone SVG image; pin a dark ink so they read on the default light board.
const MONO_INK = "#1e1e1e";

// Uniform freedraw width. Excalidraw tapers a mouse stroke because it
// synthesises pressure; pinning every sample to one value renders a plain,
// constant-weight vector pen instead of a paint brush.
const FREEDRAW_PRESSURE = 0.5;

// Excalidraw expands freedraw `strokeWidth` by ~4.25x when it builds the pen
// outline, so the same value reads much heavier in draw mode than on a shape.
// Keep shapes at 2px and give the pen its own thin default.
const SHAPE_STROKE_WIDTH = 2;
export const FREEDRAW_STROKE_WIDTH = 1;

// Defaults for anything the user draws with Excalidraw's own tools. Roughness 0
// is Excalidraw's "architect" style: crisp, straight strokes instead of the
// hand-drawn wobble that is its default. Every `currentItem*` field is pinned
// so a browser profile that has previously used Excalidraw cannot leak its
// last-used colour, fill or width into a coredraw board.
export const FORMAL_DRAW_DEFAULTS = {
  currentItemRoughness: 0,
  currentItemFontFamily: MONO_FONT_FAMILY,
  currentItemFontSize: MEDIUM_FONT_SIZE,
  currentItemTextAlign: "left" as const,
  currentItemStrokeStyle: "solid" as const,
  currentItemStrokeColor: MONO_INK,
  currentItemStrokeWidth: SHAPE_STROKE_WIDTH,
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid" as const,
  currentItemOpacity: 100,
  currentItemRoundness: "round" as const,
};

// The style controls in the editor bar. `strokeWidth` means Excalidraw's
// element width; freedraw is rendered heavier by the engine, so the draw tool
// overrides this with FREEDRAW_STROKE_WIDTH when it is selected.
export interface DrawStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  fillStyle: "solid" | "hachure" | "cross-hatch";
  opacity: number;
}

export const DEFAULT_DRAW_STYLE: DrawStyle = {
  strokeColor: MONO_INK,
  backgroundColor: "transparent",
  strokeWidth: SHAPE_STROKE_WIDTH,
  strokeStyle: "solid",
  fillStyle: "solid",
  opacity: 100,
};

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

// The scene the adapter persists. Version lives on the board row
// (`snapshot_version`), not in the blob, so the two can never disagree.
export interface SceneSnapshot {
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

// UTF-8 safe base64 (browser and node). Excalidraw decodes every image data URL
// with `atob`, so the URL must be base64 — a `;utf8,` percent-encoded URL throws
// InvalidCharacterError when the file is added to the scene.
function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function spriteToDataUrl(iconId: string): string {
  const { viewBox, body } = iconSprite(iconId);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" ` +
    `style="color:${MONO_INK}">${body}</svg>`;
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
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

function baseElement(f: BaseFields) {
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
    roughness: 0,
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

// ---------------------------------------------------------------------------
// Style normalization.
//
// Two distinct jobs, deliberately kept apart:
// - `flattenFreehandPressure` runs automatically on every change. It only
//   removes the simulated-pressure taper from freedraw strokes, because
//   Excalidraw exposes no UI setting for it and it is the main source of the
//   "paint brush" look. It never touches colour, width or roughness.
// - `applyFormalStyle` runs only when the user explicitly asks for a clean
//   board. It forces every element back onto the formal preset (architect
//   roughness, solid 2px strokes, ink colour) and is therefore destructive to
//   deliberate styling, so it is never automatic.
// ---------------------------------------------------------------------------

function bumpVersion<T extends ExcalidrawElement>(el: T): T {
  return { ...el, version: el.version + 1, versionNonce: randomInt(), updated: Date.now() };
}

function flattenFreehand(el: ExcalidrawFreeDrawElement): ExcalidrawFreeDrawElement {
  const pressures = new Array<number>(el.points.length).fill(FREEDRAW_PRESSURE);
  return bumpVersion({ ...el, simulatePressure: false, pressures });
}

export function flattenFreehandPressure(
  elements: readonly ExcalidrawElement[],
): { elements: ExcalidrawElement[]; changed: boolean } {
  let changed = false;
  const out = elements.map((el) => {
    if (el.type !== "freedraw") return el;
    const free = el as ExcalidrawFreeDrawElement;
    const flat =
      !free.simulatePressure && free.pressures.every((p) => p === FREEDRAW_PRESSURE);
    if (flat) return el;
    changed = true;
    return flattenFreehand(free);
  });
  return { elements: out, changed };
}

export function applyFormalStyle(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  return elements.map((el) => {
    let styled = el;
    if (el.type === "freedraw") {
      const free = el as ExcalidrawFreeDrawElement;
      if (free.simulatePressure || free.pressures.some((p) => p !== FREEDRAW_PRESSURE)) {
        styled = flattenFreehand(free);
      }
    }
    const width = styled.type === "freedraw" ? FREEDRAW_STROKE_WIDTH : SHAPE_STROKE_WIDTH;
    const formal =
      styled.roughness === 0 &&
      styled.strokeStyle === "solid" &&
      styled.strokeWidth === width &&
      styled.strokeColor === MONO_INK &&
      styled.opacity === 100 &&
      (styled.type !== "text" ||
        (styled as ExcalidrawTextElement).fontFamily === MONO_FONT_FAMILY);
    if (formal) return styled;
    return bumpVersion({
      ...styled,
      roughness: 0,
      strokeStyle: "solid" as const,
      strokeWidth: width,
      strokeColor: MONO_INK,
      opacity: 100,
      ...(styled.type === "text" ? { fontFamily: MONO_FONT_FAMILY } : {}),
    });
  });
}

// Apply the style bar to the current selection. Elements that do not use a
// property (the fill of a line, the stroke of an image) simply ignore it.
export function applyStyleToElements(
  elements: readonly ExcalidrawElement[],
  selectedIds: Record<string, boolean | undefined>,
  style: DrawStyle,
): ExcalidrawElement[] {
  return elements.map((el) => {
    if (el.isDeleted || !selectedIds[el.id]) return el;
    if (el.type === "image") {
      if (el.opacity === style.opacity) return el;
      return bumpVersion({ ...el, opacity: style.opacity });
    }
    if (el.type === "text") {
      if (el.strokeColor === style.strokeColor && el.opacity === style.opacity) return el;
      return bumpVersion({
        ...el,
        strokeColor: style.strokeColor,
        opacity: style.opacity,
      });
    }
    if (el.type === "freedraw") {
      const free = el as ExcalidrawFreeDrawElement;
      if (
        free.strokeColor === style.strokeColor &&
        free.strokeWidth === style.strokeWidth &&
        free.opacity === style.opacity
      ) {
        return el;
      }
      return bumpVersion({
        ...free,
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
      });
    }
    if (
      el.strokeColor === style.strokeColor &&
      el.backgroundColor === style.backgroundColor &&
      el.fillStyle === style.fillStyle &&
      el.strokeWidth === style.strokeWidth &&
      el.strokeStyle === style.strokeStyle &&
      el.opacity === style.opacity
    ) {
      return el;
    }
    return bumpVersion({
      ...el,
      strokeColor: style.strokeColor,
      backgroundColor: style.backgroundColor,
      fillStyle: style.fillStyle,
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      opacity: style.opacity,
    });
  });
}

// The file id used for every placement of one icon, so all Lambda glyphs share
// a single uploaded file. Deterministic, so re-hydration can rebuild the file.
// Must be CSS-selector safe: Excalidraw's SVG export does
// `querySelector(`#image-${fileId}`)`, so a ':' (as in "logos:aws-lambda")
// would throw an invalid-selector error.
export function iconFileId(iconId: string): string {
  return `icon-${iconId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export interface IconInsertion {
  // [imageElement, textLabel]
  elements: ExcalidrawElement[];
  file: BinaryFileData;
}

// The `files`-map entry for an icon glyph, rebuilt from the vendored sprite.
// Shared by placement and load so the two never drift.
function iconFile(fileId: string, iconId: string): BinaryFileData {
  return {
    id: fileId,
    mimeType: "image/svg+xml",
    dataURL: spriteToDataUrl(iconId),
    created: 0,
  } as unknown as BinaryFileData;
}

// Cascadia Mono advance width is a little over half an em. The label is a
// fixed-width text element, so size it to the title instead of clipping longer
// names like "AWS CloudFront" to the 96px glyph box.
const MONO_CHAR_RATIO = 0.62;

function iconLabelWidth(title: string, fontSize: number): number {
  return Math.max(ICON_SIZE, Math.ceil(title.length * fontSize * MONO_CHAR_RATIO));
}

// Build the image + editable-label pair for an icon, sharing a group so they
// select/move/delete as one (and can be ungrouped to edit independently).
export function buildIconInsertion(
  iconId: string,
  x: number,
  y: number,
  opts: { title?: string; fileId?: string } = {},
): IconInsertion {
  const title = opts.title ?? iconLabel(iconId);
  const groupId = randomId();
  const fileId = opts.fileId ?? iconFileId(iconId);
  const labelWidth = iconLabelWidth(title, MEDIUM_FONT_SIZE);

  const image = {
    ...baseElement({
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

  // The label box is sized to the title (but never narrower than the glyph)
  // and does not auto-resize, so `textAlign: "center"` keeps it centred
  // beneath the glyph without clipping.
  const label = {
    ...baseElement({
      x: x + (ICON_SIZE - labelWidth) / 2,
      y: y + ICON_SIZE + LABEL_GAP,
      width: labelWidth,
      height: LABEL_HEIGHT,
      groupIds: [groupId],
    }),
    type: "text" as const,
    fontSize: MEDIUM_FONT_SIZE,
    fontFamily: MONO_FONT_FAMILY,
    text: title,
    originalText: title,
    textAlign: "center" as const,
    verticalAlign: "top" as const,
    containerId: null,
    autoResize: false,
    lineHeight: 1.25,
  } as unknown as ExcalidrawTextElement;

  return { elements: [image, label], file: iconFile(fileId, iconId) };
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
      ...baseElement({ x, y, width: w, height: h }),
      type: kind,
      roundness: kind === "rectangle" ? { type: 3 } : null,
    } as unknown as ExcalidrawElement;
  }
  if (kind === "text") {
    return {
      ...baseElement({ x, y, width: 120, height: 25 }),
      type: "text",
      fontSize: MEDIUM_FONT_SIZE,
      fontFamily: MONO_FONT_FAMILY,
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
      ...baseElement({ x, y, width: 200, height: 0 }),
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
    ...baseElement({ x, y, width: 320, height: 220 }),
    type: "frame",
    name: null,
  } as unknown as ExcalidrawElement;
}

// A straight connector between two scene points, used by the diagram templates.
export function buildArrow(
  from: { x: number; y: number },
  to: { x: number; y: number },
): ExcalidrawLinearElement {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    ...baseElement({ x: from.x, y: from.y, width: Math.abs(dx), height: Math.abs(dy) }),
    type: "arrow",
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    roundness: { type: 2 },
  } as unknown as ExcalidrawLinearElement;
}

// ---------------------------------------------------------------------------
// Snapshot ↔ scene.
// ---------------------------------------------------------------------------

function pickDurableAppState(appState: Partial<AppState>): DurableAppState {
  return {
    viewBackgroundColor: appState.viewBackgroundColor ?? DEFAULT_APP_STATE.viewBackgroundColor,
    gridSize: appState.gridSize ?? DEFAULT_APP_STATE.gridSize,
    gridModeEnabled: appState.gridModeEnabled ?? DEFAULT_APP_STATE.gridModeEnabled,
  };
}

export function sceneToSnapshot(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
): SceneSnapshot {
  return {
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
    files[image.fileId] = iconFile(image.fileId, iconId);
  }
  return files;
}

// Read the element list + durable appState out of a stored blob, provided the
// board row's own `snapshot_version` matches this build. The blob's shape is
// trusted only after that gate, so an old-format board is discarded, not parsed.
function asSceneSnapshot(raw: unknown, boardVersion: number): SceneSnapshot | null {
  if (boardVersion !== SNAPSHOT_VERSION) return null;
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { elements?: unknown; appState?: unknown };
  if (!Array.isArray(s.elements)) return null;
  return {
    elements: s.elements as ExcalidrawElement[],
    appState: pickDurableAppState((s.appState ?? {}) as Partial<AppState>),
  };
}

// Load an opaque snapshot into a scene. A board row whose `snapshot_version`
// is not this build's (or a fresh board's `{}`) yields a blank canvas rather
// than an error.
export function snapshotToScene(raw: unknown, boardVersion: number): LoadedScene {
  const snap = asSceneSnapshot(raw, boardVersion);
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
// exactly these.
export type RailToolId =
  | "select"
  | "hand"
  | "draw"
  | "eraser"
  | "text"
  | "arrow"
  | "line"
  | "frame";

const RAIL_TOOL_IDS: RailToolId[] = [
  "select",
  "hand",
  "draw",
  "eraser",
  "text",
  "arrow",
  "line",
  "frame",
];

// Tools placed from the palette rather than the rail; eraser.io also binds them
// to bare keys, so they ride the same shortcut map.
export type PaletteToolId = "rectangle" | "ellipse";

// Every tool a shortcut or the rail can select.
export type CanvasTool = RailToolId | PaletteToolId;

export const TOOL_MAP: Record<CanvasTool, ToolType> = {
  select: "selection",
  hand: "hand",
  draw: "freedraw",
  eraser: "eraser",
  text: "text",
  arrow: "arrow",
  line: "line",
  frame: "frame",
  rectangle: "rectangle",
  ellipse: "ellipse",
};

// eraser.io-style single-key tool shortcuts. Most coincide with Excalidraw's
// own bindings, but `d` deliberately does not (Excalidraw binds `d` to the
// diamond): the page intercepts these at the window so our mapping always wins.
export const TOOL_SHORTCUTS: Record<string, CanvasTool> = {
  v: "select",
  h: "hand",
  d: "draw",
  e: "eraser",
  t: "text",
  r: "rectangle",
  o: "ellipse",
  a: "arrow",
  l: "line",
  f: "frame",
};

export function toolForShortcut(key: string): CanvasTool | null {
  return TOOL_SHORTCUTS[key.toLowerCase()] ?? null;
}

// The rail tool a canvas tool corresponds to, or null for palette-only tools
// (rectangle, ellipse) — the rail highlights nothing for those.
export function railToolForCanvasTool(tool: CanvasTool): RailToolId | null {
  return (RAIL_TOOL_IDS as string[]).includes(tool) ? (tool as RailToolId) : null;
}

// Reverse of TOOL_MAP: the rail tool matching an Excalidraw active tool, so the
// rail can highlight what the engine reports.
const RAIL_TOOL_BY_EXCALIDRAW = new Map<ToolType, RailToolId>(
  RAIL_TOOL_IDS.map((id) => [TOOL_MAP[id], id]),
);

export function railToolForExcalidrawTool(toolType: string): RailToolId | null {
  return RAIL_TOOL_BY_EXCALIDRAW.get(toolType as ToolType) ?? null;
}

// ---------------------------------------------------------------------------
// The live canvas adapter. The page drives the canvas only through this
// interface, so Excalidraw stays behind the seam; the implementation lives in
// excalidraw-canvas.tsx, which owns the imperative API.
// ---------------------------------------------------------------------------

export interface CanvasAdapter {
  // Current scene as a persistable snapshot, or null when nothing is mounted.
  toSnapshot(): SceneSnapshot | null;
  // Report the engine's change event. Returns true only when the content
  // actually changed (view-only churn and the first post-mount normalization
  // are ignored), signalling the page to arm a save.
  noteSceneChange(): boolean;
  // The rail tool the canvas currently has active, for highlighting, or null.
  activeRailTool(): RailToolId | null;
  setTool(tool: CanvasTool): void;
  insertIcon(iconId: string): void;
  insertShape(kind: ShapeKind): void;
  // Insert a ready-made diagram at the viewport centre.
  insertTemplate(templateId: string): void;
  // Apply a style to the selected elements (or just the active tool defaults
  // when nothing is selected) and report the resulting style.
  applyStyle(style: DrawStyle): void;
  currentStyle(): DrawStyle;
  // Re-style every element on the board to the formal preset (roughness 0,
  // solid ink strokes; freedraw is thinner than shapes). User-initiated only —
  // it overwrites deliberate styling.
  normalizeBoard(): void;
  exportImage(format: "png" | "svg"): Promise<void>;
}
