// Data for the editor chrome: the tool rail and the left palette.
//
// Engine-agnostic: the rail names a `RailToolId` (the adapter maps it to an
// Excalidraw tool) and each shape names a `ShapeKind` the adapter builds. No
// engine types leak in here.

import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Pen,
  Square,
  Type,
} from "lucide-react";
import type { RailToolId, ShapeKind } from "@/pages/dashboard/draw/engine";

export interface RailTool {
  id: RailToolId;
  title: string;
  // Excalidraw's own single-key shortcut, shown as a hint.
  hint?: string;
  icon: LucideIcon;
}

export const RAIL_TOOLS: RailTool[] = [
  { id: "select", title: "Select", hint: "v", icon: MousePointer2 },
  { id: "hand", title: "Pan", hint: "h", icon: Hand },
  { id: "draw", title: "Draw", hint: "p", icon: Pen },
  { id: "eraser", title: "Eraser", hint: "e", icon: Eraser },
  { id: "text", title: "Text", hint: "t", icon: Type },
  { id: "arrow", title: "Arrow", hint: "a", icon: ArrowRight },
  { id: "line", title: "Line", hint: "l", icon: Minus },
  { id: "frame", title: "Frame", hint: "f", icon: Frame },
];

export interface ShapeItem {
  id: string;
  title: string;
  kind: ShapeKind;
  icon: LucideIcon;
  keywords: string[];
}

// Only Excalidraw's native primitives; the tldraw-only geo variants are gone.
export const SHAPE_ITEMS: ShapeItem[] = [
  { id: "shape-rectangle", title: "Rectangle", kind: "rectangle", icon: Square, keywords: ["shape", "rectangle", "box"] },
  { id: "shape-ellipse", title: "Ellipse", kind: "ellipse", icon: Circle, keywords: ["shape", "ellipse", "circle", "oval"] },
  { id: "shape-diamond", title: "Diamond", kind: "diamond", icon: Diamond, keywords: ["shape", "diamond", "rhombus"] },
  { id: "shape-arrow", title: "Arrow", kind: "arrow", icon: ArrowRight, keywords: ["shape", "arrow", "connector"] },
  { id: "shape-line", title: "Line", kind: "line", icon: Minus, keywords: ["shape", "line"] },
  { id: "shape-text", title: "Text", kind: "text", icon: Type, keywords: ["shape", "text", "label"] },
  { id: "shape-frame", title: "Frame", kind: "frame", icon: Frame, keywords: ["shape", "frame", "group"] },
];
