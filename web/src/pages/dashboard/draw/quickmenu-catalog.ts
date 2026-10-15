import type { Editor, TLShapeId } from "tldraw";
import { COPY_AS_JSON_SHORTCUT, TOOL_SHORTCUTS } from "@/pages/dashboard/draw/shortcuts";
import { runCopySelectionAsJson } from "@/pages/dashboard/draw/jsonclipboard";

export interface QuickMenuEntry {
  id: string;
  title: string;
  keywords?: string[];
  hint: string;
  run: (editor: Editor) => void;
}

export interface QuickMenuSection {
  heading: string;
  entries: QuickMenuEntry[];
}

// The geo variants tldraw supports, pinned here so the menu doesn't depend
// on schema internals. Must match the SDK's geo style or inserts fail.
const GEO_VARIANTS = [
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "trapezoid",
  "rhombus",
  "rhombus-2",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "cloud",
  "heart",
  "oval",
  "x-box",
  "check-box",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-down",
] as const;

type GeoVariant = (typeof GEO_VARIANTS)[number];

function newShapeId(): TLShapeId {
  return `shape:${crypto.randomUUID()}` as TLShapeId;
}

function viewportCenter(editor: Editor): { x: number; y: number } {
  const vp = editor.getViewportPageBounds();
  return { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 };
}

function insertGeo(editor: Editor, geo: GeoVariant): void {
  const { x, y } = viewportCenter(editor);
  const id = newShapeId();
  editor.createShape({ id, type: "geo", x: x - 100, y: y - 100, props: { geo, w: 200, h: 200 } });
  editor.setSelectedShapes([id]);
}

function insertShape(editor: Editor, type: "arrow" | "text" | "note" | "frame" | "line"): void {
  const { x, y } = viewportCenter(editor);
  const id = newShapeId();
  editor.createShape({ id, type, x, y });
  editor.setSelectedShapes([id]);
}

const TOOL_ENTRIES: QuickMenuEntry[] = [
  { id: "tool-select", title: "Select", hint: TOOL_SHORTCUTS.select, run: (editor) => editor.setCurrentTool("select") },
  { id: "tool-hand", title: "Hand (pan)", hint: TOOL_SHORTCUTS.hand, run: (editor) => editor.setCurrentTool("hand") },
  { id: "tool-draw", title: "Draw", hint: TOOL_SHORTCUTS.draw, run: (editor) => editor.setCurrentTool("draw") },
  { id: "tool-eraser", title: "Eraser", hint: TOOL_SHORTCUTS.eraser, run: (editor) => editor.setCurrentTool("eraser") },
];

// Geo variants that duplicate a single-key shortcut show it; the rest just insert.
const GEO_HINTS: Partial<Record<GeoVariant, string>> = {
  rectangle: TOOL_SHORTCUTS.rectangle,
  ellipse: TOOL_SHORTCUTS.ellipse,
};

const SHAPE_ENTRIES: QuickMenuEntry[] = [
  ...GEO_VARIANTS.map(
    (geo): QuickMenuEntry => ({
      id: `shape-${geo}`,
      title: `${geo.charAt(0).toUpperCase() + geo.slice(1)} shape`,
      keywords: [geo],
      hint: GEO_HINTS[geo] ?? "insert",
      run: (editor) => insertGeo(editor, geo),
    }),
  ),
  { id: "shape-arrow", title: "Arrow", hint: TOOL_SHORTCUTS.arrow, run: (editor) => insertShape(editor, "arrow") },
  { id: "shape-text", title: "Text", hint: TOOL_SHORTCUTS.text, run: (editor) => insertShape(editor, "text") },
  { id: "shape-note", title: "Sticky note", hint: TOOL_SHORTCUTS.note, run: (editor) => insertShape(editor, "note") },
  { id: "shape-frame", title: "Frame", hint: TOOL_SHORTCUTS.frame, run: (editor) => insertShape(editor, "frame") },
  { id: "shape-line", title: "Line", hint: TOOL_SHORTCUTS.line, run: (editor) => insertShape(editor, "line") },
];

const CLIPBOARD_ENTRIES: QuickMenuEntry[] = [
  {
    id: "copy-as-json",
    title: "Copy selection as JSON",
    keywords: ["clipboard", "export"],
    hint: COPY_AS_JSON_SHORTCUT.split(",")[0],
    run: runCopySelectionAsJson,
  },
];

// Ticket 06 fills this with the AWS sprite catalog; the menu renders whatever it holds.
const ICON_ENTRIES: QuickMenuEntry[] = [];

export function buildQuickMenuSections(): QuickMenuSection[] {
  return [
    { heading: "Tools", entries: TOOL_ENTRIES },
    { heading: "Shapes", entries: SHAPE_ENTRIES },
    ...(ICON_ENTRIES.length > 0 ? [{ heading: "Icons", entries: ICON_ENTRIES }] : []),
    { heading: "Clipboard", entries: CLIPBOARD_ENTRIES },
  ];
}
