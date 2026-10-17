// Data for the editor chrome: the tool rail and the left palette.
//
// Tools switch the current tldraw tool; shapes insert a new shape. Icons come
// straight from icon-catalog.ts (vendored sprite).

import { createShapeId, type Editor, type TLGeoShape, type TLShapeId } from "tldraw";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Circle,
  Cloud,
  Diamond,
  Frame,
  Heart,
  Hexagon,
  Minus,
  MousePointer2,
  Octagon,
  Pen,
  Pentagon,
  Eraser,
  Square,
  Star,
  StickyNote,
  Triangle,
  Type,
  Hand,
} from "lucide-react";
import { TOOL_SHORTCUTS } from "@/pages/dashboard/draw/shortcuts";

export interface RailTool {
  id: string;
  tool: string;
  title: string;
  hint?: string;
  icon: LucideIcon;
}

export const RAIL_TOOLS: RailTool[] = [
  { id: "select", tool: "select", title: "Select", hint: TOOL_SHORTCUTS.select, icon: MousePointer2 },
  { id: "hand", tool: "hand", title: "Pan", hint: TOOL_SHORTCUTS.hand, icon: Hand },
  { id: "draw", tool: "draw", title: "Draw", hint: TOOL_SHORTCUTS.draw, icon: Pen },
  { id: "eraser", tool: "eraser", title: "Eraser", hint: TOOL_SHORTCUTS.eraser, icon: Eraser },
  { id: "text", tool: "text", title: "Text", hint: TOOL_SHORTCUTS.text, icon: Type },
  { id: "arrow", tool: "arrow", title: "Arrow", hint: TOOL_SHORTCUTS.arrow, icon: ArrowRight },
  { id: "line", tool: "line", title: "Line", hint: TOOL_SHORTCUTS.line, icon: Minus },
  { id: "frame", tool: "frame", title: "Frame", hint: TOOL_SHORTCUTS.frame, icon: Frame },
];

// Geometry variants tldraw supports, pinned here so the palette doesn't depend
// on schema internals. Must match the SDK's geo style or inserts fail.
type GeoVariant = TLGeoShape["props"]["geo"];

const GEO_VARIANTS: { geo: GeoVariant; title: string; icon: LucideIcon }[] = [
  { geo: "rectangle", title: "Rectangle", icon: Square },
  { geo: "ellipse", title: "Ellipse", icon: Circle },
  { geo: "diamond", title: "Diamond", icon: Diamond },
  { geo: "triangle", title: "Triangle", icon: Triangle },
  { geo: "pentagon", title: "Pentagon", icon: Pentagon },
  { geo: "hexagon", title: "Hexagon", icon: Hexagon },
  { geo: "octagon", title: "Octagon", icon: Octagon },
  { geo: "star", title: "Star", icon: Star },
  { geo: "cloud", title: "Cloud", icon: Cloud },
  { geo: "heart", title: "Heart", icon: Heart },
  { geo: "x-box", title: "Cross", icon: Square },
  { geo: "check-box", title: "Check box", icon: Square },
  { geo: "arrow-left", title: "Arrow left", icon: ArrowLeft },
  { geo: "arrow-right", title: "Arrow right", icon: ArrowRight },
  { geo: "arrow-up", title: "Arrow up", icon: ArrowUp },
  { geo: "arrow-down", title: "Arrow down", icon: ArrowDown },
];

export interface ShapeItem {
  id: string;
  title: string;
  hint?: string;
  icon: LucideIcon;
  keywords: string[];
  run: (editor: Editor) => void;
}

function newShapeId(): TLShapeId {
  return createShapeId();
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

export const SHAPE_ITEMS: ShapeItem[] = [
  ...GEO_VARIANTS.map(
    (g): ShapeItem => ({
      id: `geo-${g.geo}`,
      title: g.title,
      icon: g.icon,
      keywords: ["shape", "geo", g.geo],
      run: (editor) => insertGeo(editor, g.geo),
    }),
  ),
  { id: "shape-arrow", title: "Arrow", hint: TOOL_SHORTCUTS.arrow, icon: ArrowRight, keywords: ["shape", "arrow", "line", "connector"], run: (e) => insertShape(e, "arrow") },
  { id: "shape-line", title: "Line", hint: TOOL_SHORTCUTS.line, icon: Minus, keywords: ["shape", "line"], run: (e) => insertShape(e, "line") },
  { id: "shape-text", title: "Text", hint: TOOL_SHORTCUTS.text, icon: Type, keywords: ["shape", "text", "label"], run: (e) => insertShape(e, "text") },
  { id: "shape-note", title: "Sticky note", hint: TOOL_SHORTCUTS.note, icon: StickyNote, keywords: ["shape", "note", "sticky"], run: (e) => insertShape(e, "note") },
  { id: "shape-frame", title: "Frame", hint: TOOL_SHORTCUTS.frame, icon: Frame, keywords: ["shape", "frame", "group"], run: (e) => insertShape(e, "frame") },
];
