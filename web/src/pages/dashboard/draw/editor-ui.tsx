// Editor chrome for coredraw — an eraser.io-inspired left rail + searchable
// left palette over the Excalidraw canvas.
//
// This module is engine-agnostic: it renders and reports intent through
// callbacks, and never imports the drawing engine. The page wires those
// callbacks to the canvas adapter.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Boxes,
  ChevronLeft,
  Download,
  Layers,
  Maximize2,
  MoreHorizontal,
  PenTool,
  Redo2,
  Search,
  Shapes,
  Sparkles,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ICON_FAMILIES, ICON_ENTRIES, iconSprite, type IconEntry } from "@/pages/dashboard/draw/icon-catalog";
import { RAIL_TOOLS, SHAPE_ITEMS, type ShapeItem } from "@/pages/dashboard/draw/palette-catalog";
import { DIAGRAM_TEMPLATES } from "@/pages/dashboard/draw/templates";
import type { DrawStyle, RailToolId, ShapeKind } from "@/pages/dashboard/draw/engine";

export type PaletteTab = "icons" | "shapes";

// A vendored sprite glyph for the palette grid. Coloured families (logos) carry
// their own fills; monochrome families (mdi) inherit currentColor so they read
// in both light and dark chrome.
function PaletteGlyph({ iconId }: { iconId: string }) {
  const sprite = iconSprite(iconId);
  return (
    <svg
      viewBox={sprite.viewBox}
      width="100%"
      height="100%"
      fill="currentColor"
      aria-hidden
      // Sprite bodies are generated from Iconify and committed — trusted
      // markup, never user input.
      dangerouslySetInnerHTML={{ __html: sprite.body }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tool rail
// ---------------------------------------------------------------------------

function ToolButton({
  active,
  title,
  hint,
  onClick,
  size = "rail",
  disabled,
  ariaLabel,
  children,
}: {
  active?: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
  // The phone bar needs a 44px target; the desktop rail keeps its compact 36px.
  size?: "rail" | "toolbar";
  disabled?: boolean;
  // Use when the visible text is the important part of the accessible name.
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={hint ? `${title} (${hint})` : title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "toolbar" ? "h-11 w-11 shrink-0 touch-manipulation" : "h-9 w-9",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ToolRail({
  activeTool,
  onSelectTool,
  paletteOpen,
  paletteTab,
  onOpenPalette,
  penDetected,
  penMode,
  onTogglePenMode,
}: {
  activeTool: RailToolId | null;
  onSelectTool: (id: RailToolId) => void;
  paletteOpen: boolean;
  paletteTab: PaletteTab;
  onOpenPalette: (tab: PaletteTab) => void;
  penDetected: boolean;
  penMode: boolean;
  onTogglePenMode: () => void;
}) {
  return (
    <div
      data-testid="draw-tool-rail"
      className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2 md:flex"
    >
      {RAIL_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          title={t.title}
          hint={t.hint}
          active={activeTool === t.id}
          onClick={() => onSelectTool(t.id)}
        >
          <t.icon className="h-[18px] w-[18px]" />
        </ToolButton>
      ))}

      {penDetected && (
        <ToolButton title="Pen mode" active={penMode} onClick={onTogglePenMode}>
          <PenTool className="h-[18px] w-[18px]" />
        </ToolButton>
      )}

      <div className="my-1 h-px w-6 bg-border" />

      <ToolButton
        title="Shapes"
        active={paletteOpen && paletteTab === "shapes"}
        onClick={() => onOpenPalette("shapes")}
      >
        <Shapes className="h-[18px] w-[18px]" />
      </ToolButton>
      <ToolButton
        title="Icons"
        active={paletteOpen && paletteTab === "icons"}
        onClick={() => onOpenPalette("icons")}
      >
        <Layers className="h-[18px] w-[18px]" />
      </ToolButton>
    </div>
  );
}

// The phone toolbar. A tablet keeps the side rail, so this only renders below
// the md breakpoint. The eight drawing tools fill the first row; style, insert,
// pen mode and zoom share the second. Undo/redo sit in the compact top bar.
export interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomToFit: () => void;
}

export interface HistoryZoomControlsProps extends ZoomControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function MobileToolbar({
  activeTool,
  onSelectTool,
  paletteOpen,
  onTogglePalette,
  styleOpen,
  styleColor,
  onOpenStyle,
  penDetected,
  penMode,
  onTogglePenMode,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomToFit,
}: {
  activeTool: RailToolId | null;
  onSelectTool: (id: RailToolId) => void;
  paletteOpen: boolean;
  onTogglePalette: () => void;
  styleOpen: boolean;
  styleColor: string;
  onOpenStyle: () => void;
  penDetected: boolean;
  penMode: boolean;
  onTogglePenMode: () => void;
} & ZoomControlsProps) {
  return (
    <div
      data-draw-toolbar
      data-testid="draw-mobile-toolbar"
      className="flex shrink-0 touch-manipulation flex-wrap items-center justify-center gap-0.5 border-t border-border bg-background px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] md:hidden"
    >
      {RAIL_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          size="toolbar"
          title={t.title}
          hint={t.hint}
          active={activeTool === t.id}
          onClick={() => onSelectTool(t.id)}
        >
          <t.icon className="h-5 w-5" />
        </ToolButton>
      ))}
      {penDetected && (
        <ToolButton
          size="toolbar"
          title="Pen mode"
          active={penMode}
          onClick={onTogglePenMode}
        >
          <PenTool className="h-5 w-5" />
        </ToolButton>
      )}
      <ToolButton size="toolbar" title="Style" active={styleOpen} onClick={onOpenStyle}>
        <span
          aria-hidden
          className="block h-5 w-5 rounded-full border border-foreground/30"
          style={{ background: styleColor }}
        />
      </ToolButton>
      <ToolButton size="toolbar" title="Insert" active={paletteOpen} onClick={onTogglePalette}>
        <Boxes className="h-5 w-5" />
      </ToolButton>
      <ToolButton size="toolbar" title="Zoom out" onClick={onZoomOut}>
        <ZoomOut className="h-5 w-5" />
      </ToolButton>
      <ToolButton
        size="toolbar"
        title="Reset zoom to 100%"
        ariaLabel={`${Math.round(zoom * 100)}% zoom, reset to 100%`}
        onClick={onResetZoom}
      >
        <span className="text-[10px] tabular-nums">{Math.round(zoom * 100)}%</span>
      </ToolButton>
      <ToolButton size="toolbar" title="Zoom in" onClick={onZoomIn}>
        <ZoomIn className="h-5 w-5" />
      </ToolButton>
      <ToolButton size="toolbar" title="Zoom to fit" onClick={onZoomToFit}>
        <Maximize2 className="h-5 w-5" />
      </ToolButton>
    </div>
  );
}

// Desktop/tablet history and zoom cluster, floating over the bottom-left of
// the canvas where Excalidraw's own footer used to be.
export function HistoryZoomControls({
  canUndo,
  canRedo,
  zoom,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomToFit,
}: HistoryZoomControlsProps) {
  const button =
    "flex h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="absolute bottom-3 left-3 z-10 hidden items-center gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 shadow-sm backdrop-blur-sm md:flex">
      <button type="button" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className={button}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className={button}>
        <Redo2 className="h-4 w-4" />
      </button>
      <div className="mx-0.5 h-5 w-px bg-border" />
      <button type="button" aria-label="Zoom out" onClick={onZoomOut} className={button}>
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Reset zoom to 100%"
        aria-label={`${Math.round(zoom * 100)}% zoom, reset to 100%`}
        onClick={onResetZoom}
        className={cn(button, "min-w-14 text-[10px] tabular-nums")}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" onClick={onZoomIn} className={button}>
        <ZoomIn className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Zoom to fit" onClick={onZoomToFit} className={button}>
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

function matches(entry: IconEntry, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = `${entry.title} ${entry.keywords.join(" ")}`.toLowerCase();
  return tokens.every((tk) => hay.includes(tk));
}

function IconTile({
  entry,
  index,
  active,
  onHover,
  onPick,
}: {
  entry: IconEntry;
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${entry.title} (${entry.familyLabel} · ${entry.category})`}
      data-palette-index={index}
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn(
        "group flex flex-col items-center gap-0.5 rounded-md border border-transparent p-1 text-center transition-colors hover:border-border hover:bg-muted/60",
        active && "border-border bg-muted",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center text-foreground">
        <PaletteGlyph iconId={entry.id} />
      </span>
      <span
        className={cn(
          "w-full truncate text-[9px] leading-tight text-muted-foreground group-hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {entry.title}
      </span>
    </button>
  );
}

function ShapeTile({ item, onPick }: { item: ShapeItem; onPick: () => void }) {
  return (
    <button
      type="button"
      title={item.title}
      onClick={onPick}
      className="group flex flex-col items-center gap-0.5 rounded-md border border-transparent p-1 text-center transition-colors hover:border-border hover:bg-muted/60"
    >
      <span className="flex h-7 w-7 items-center justify-center">
        <item.icon className="h-4 w-4 text-foreground/80 group-hover:text-foreground" />
      </span>
      <span className="w-full truncate text-[9px] leading-tight text-muted-foreground group-hover:text-foreground">
        {item.title}
      </span>
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full mt-1 px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70 first:mt-0 first:pt-0">
      {children}
    </div>
  );
}

export function IconPalette({
  open,
  tab,
  focusNonce,
  onTabChange,
  onClose,
  onPickIcon,
  onPickShape,
  onPickTemplate,
  sheet = false,
  focusOnOpen = true,
}: {
  open: boolean;
  tab: PaletteTab;
  // Bumped by the page when `/` is pressed, so search refocuses even when the
  // palette is already open.
  focusNonce: number;
  onTabChange: (tab: PaletteTab) => void;
  onClose: () => void;
  onPickIcon: (iconId: string) => void;
  onPickShape: (kind: ShapeKind) => void;
  onPickTemplate: (templateId: string) => void;
  // Inside a phone bottom sheet, fill the sheet instead of the side column.
  sheet?: boolean;
  // A phone tap should not raise the soft keyboard over the icon grid; only a
  // keyboard `/` open asks for search focus.
  focusOnOpen?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string>("all");
  // Index into `results` for the keyboard highlight; -1 means nothing is
  // highlighted (empty query), so Enter cannot insert an arbitrary first icon.
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && focusOnOpen) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => clearTimeout(t);
    }
  }, [open, focusNonce, focusOnOpen]);

  // Typing highlights the top hit, so `/` → "s3" → Enter needs no arrow keys.
  useEffect(() => {
    setActiveIndex(query.trim() ? 0 : -1);
  }, [query, tab]);

  const tokens = useMemo(
    () =>
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [query],
  );

  // Search looks across every family so "aws" surfaces the whole AWS set;
  // the family tabs only steer browsing when the field is empty.
  const results = useMemo(() => {
    const pool = tokens.length
      ? ICON_ENTRIES
      : family === "all"
        ? ICON_ENTRIES
        : ICON_ENTRIES.filter((e) => e.family === family);
    return pool.filter((e) => matches(e, tokens));
  }, [tokens, family]);

  // Group by family, then by category, so browsing reads like eraser.
  const grouped = useMemo(() => {
    const byFamily = new Map<string, Map<string, IconEntry[]>>();
    for (const entry of results) {
      if (!byFamily.has(entry.family)) byFamily.set(entry.family, new Map());
      const cats = byFamily.get(entry.family)!;
      if (!cats.has(entry.category)) cats.set(entry.category, []);
      cats.get(entry.category)!.push(entry);
    }
    return byFamily;
  }, [results]);

  const indexById = useMemo(
    () => new Map(results.map((entry, index) => [entry.id, index])),
    [results],
  );
  const activeResult = activeIndex < 0 ? -1 : Math.min(activeIndex, results.length - 1);

  // Keep the keyboard highlight visible while arrowing through a long list.
  useEffect(() => {
    if (!open || activeResult < 0) return;
    listRef.current
      ?.querySelector(`[data-palette-index="${activeResult}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResult, open]);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      if (!results.length) return;
      setActiveIndex(activeResult < 0 ? 0 : (activeResult + 1) % results.length);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      if (!results.length) return;
      setActiveIndex(activeResult < 0 ? results.length - 1 : (activeResult - 1 + results.length) % results.length);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    const entry = activeResult < 0 ? undefined : results[activeResult];
    if (!entry) return;
    onPickIcon(entry.id);
    // `/` is the fast path: insert and get out of the way so the next
    // keystroke reaches the canvas. Clear the query for the next invocation.
    setQuery("");
    onClose();
  }

  // Inside a sheet, keep the content mounted while the sheet animates out.
  if (!open && !sheet) return null;

  return (
    <aside
      className={cn(
        "flex flex-col bg-background",
        sheet ? "min-h-0 flex-1" : "w-60 shrink-0 border-r border-border",
      )}
    >
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => onTabChange("icons")}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium",
            tab === "icons" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Layers className="h-3 w-3" /> Icons
        </button>
        <button
          type="button"
          onClick={() => onTabChange("shapes")}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium",
            tab === "shapes" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Shapes className="h-3 w-3" /> Shapes
        </button>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {tab === "icons" ? (
        <>
          <div className="shrink-0 border-b border-border p-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-1">
              <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search icons…"
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            {tokens.length === 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[{ id: "all", label: "All" }, ...ICON_FAMILIES.map((f) => ({ id: f.id, label: f.label }))].map(
                  (f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFamily(f.id)}
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                        family === f.id
                          ? "border-border bg-muted text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {f.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">No icons match “{query}”.</p>
            ) : (
              [...grouped.entries()].map(([familyId, cats]) => {
                const familyLabel = ICON_FAMILIES.find((f) => f.id === familyId)?.label ?? familyId;
                return (
                  <section key={familyId}>
                    <h3 className="px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
                      {familyLabel}
                    </h3>
                    {[...cats.entries()].map(([category, entries]) => (
                      <div key={category}>
                        <SectionHeading>{category}</SectionHeading>
                        <div className="grid grid-cols-4 gap-0.5">
                          {entries.map((entry) => {
                            const index = indexById.get(entry.id) ?? -1;
                            return (
                              <IconTile
                                key={entry.id}
                                entry={entry}
                                index={index}
                                active={index === activeResult}
                                onHover={() => setActiveIndex(index)}
                                onPick={() => onPickIcon(entry.id)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <h3 className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            Templates
          </h3>
          <div className="flex flex-col gap-1">
            {DIAGRAM_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                title={`Insert ${template.title}`}
                onClick={() => onPickTemplate(template.id)}
                className="flex items-center gap-1.5 rounded-md border border-border/60 p-1 text-left transition-colors hover:border-border hover:bg-muted/60"
              >
                <span className="flex shrink-0 -space-x-1">
                  {template.icons.map((iconId) => (
                    <span
                      key={iconId}
                      className="flex h-5 w-5 items-center justify-center rounded bg-muted p-0.5 text-foreground"
                    >
                      <PaletteGlyph iconId={iconId} />
                    </span>
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-medium leading-tight">{template.title}</span>
                  <span className="block truncate text-[9px] leading-tight text-muted-foreground">
                    {template.description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <h3 className="px-1 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            Shapes
          </h3>
          <div className="grid grid-cols-4 gap-0.5">
            {SHAPE_ITEMS.map((item) => (
              <ShapeTile key={item.id} item={item} onPick={() => onPickShape(item.kind)} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Style bar
// ---------------------------------------------------------------------------

const STROKE_COLORS = [
  { name: "Ink", value: "#1e1e1e" },
  { name: "Slate", value: "#64748b" },
  { name: "Blue", value: "#2563eb" },
  { name: "Green", value: "#16a34a" },
  { name: "Red", value: "#dc2626" },
  { name: "Amber", value: "#d97706" },
];

const FILL_COLORS = [
  { name: "No fill", value: "transparent" },
  { name: "White", value: "#ffffff" },
  { name: "Slate", value: "#e2e8f0" },
  { name: "Blue", value: "#dbeafe" },
  { name: "Green", value: "#dcfce7" },
  { name: "Red", value: "#fee2e2" },
  { name: "Amber", value: "#fef3c7" },
];

const STROKE_WIDTHS = [1, 2, 4];
const STROKE_STYLES: { value: DrawStyle["strokeStyle"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];
const OPACITIES = [100, 60, 30];

function StyleGroup({
  label,
  children,
  stacked = false,
}: {
  label: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(stacked ? "flex flex-col gap-2" : "flex items-center gap-1")}
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">{label}</span>
      <div className={cn("flex items-center gap-1", stacked && "flex-wrap")}>{children}</div>
    </div>
  );
}

function Swatch({
  name,
  value,
  active,
  onClick,
}: {
  name: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  const transparent = value === "transparent";
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={active}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center md:h-4 md:w-4"
    >
      <span
        className={cn(
          "block h-4 w-4 rounded-full border transition-transform md:h-full md:w-full",
          active ? "border-foreground ring-2 ring-foreground/40" : "border-border hover:scale-110",
        )}
        style={{
          background: transparent
            ? "repeating-linear-gradient(45deg, transparent 0 3px, var(--muted-foreground) 3px 4px)"
            : value,
        }}
      />
    </button>
  );
}

function StrokeSwatches({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <>
      {STROKE_COLORS.map((color) => (
        <Swatch
          key={color.value}
          name={color.name}
          value={color.value}
          active={style.strokeColor === color.value}
          onClick={() => onChange({ strokeColor: color.value })}
        />
      ))}
    </>
  );
}

function FillSwatches({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <>
      {FILL_COLORS.map((color) => (
        <Swatch
          key={color.value}
          name={color.name}
          value={color.value}
          active={style.backgroundColor === color.value}
          onClick={() =>
            onChange({
              backgroundColor: color.value,
              fillStyle: color.value === "transparent" ? "solid" : style.fillStyle,
            })
          }
        />
      ))}
    </>
  );
}

function WidthOptions({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <>
      {STROKE_WIDTHS.map((width) => (
        <button
          key={width}
          type="button"
          title={`${width}px stroke`}
          aria-label={`${width}px stroke`}
          aria-pressed={style.strokeWidth === width}
          onClick={() => onChange({ strokeWidth: width })}
          className={cn(
            "flex h-11 w-11 touch-manipulation items-center justify-center rounded border transition-colors md:h-6 md:w-6",
            style.strokeWidth === width
              ? "border-foreground/40 bg-muted text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted/60",
          )}
        >
          <span className="block w-3.5 rounded-full bg-current" style={{ height: width }} />
        </button>
      ))}
    </>
  );
}

function DashOptions({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <>
      {STROKE_STYLES.map((item) => (
        <button
          key={item.value}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-pressed={style.strokeStyle === item.value}
          onClick={() => onChange({ strokeStyle: item.value })}
          className={cn(
            "flex h-11 min-w-11 touch-manipulation items-center justify-center rounded border transition-colors md:h-6 md:min-w-0 md:w-7",
            style.strokeStyle === item.value
              ? "border-foreground/40 bg-muted text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted/60",
          )}
        >
          <span
            className="block w-3.5 border-t-2 border-current"
            style={{ borderTopStyle: item.value }}
          />
        </button>
      ))}
    </>
  );
}

function OpacityOptions({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <>
      {OPACITIES.map((opacity) => (
        <button
          key={opacity}
          type="button"
          title={`${opacity}% opacity`}
          aria-label={`${opacity}% opacity`}
          aria-pressed={style.opacity === opacity}
          onClick={() => onChange({ opacity })}
          className={cn(
            "flex h-11 min-w-11 touch-manipulation items-center justify-center rounded border px-1.5 text-[10px] transition-colors md:h-6 md:min-w-0",
            style.opacity === opacity
              ? "border-foreground/40 bg-muted text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted/60",
          )}
        >
          {opacity}%
        </button>
      ))}
    </>
  );
}

export function StyleBar({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <div className="flex shrink-0 touch-manipulation items-center gap-2 overflow-x-auto border-b border-border bg-background px-2 py-1">
      <StyleGroup label="Stroke">
        <StrokeSwatches style={style} onChange={onChange} />
      </StyleGroup>
      <div className="h-4 w-px shrink-0 bg-border" />
      <StyleGroup label="Fill">
        <FillSwatches style={style} onChange={onChange} />
      </StyleGroup>
      <div className="h-4 w-px shrink-0 bg-border" />
      <StyleGroup label="Width">
        <WidthOptions style={style} onChange={onChange} />
      </StyleGroup>
      <div className="h-4 w-px shrink-0 bg-border" />
      <StyleGroup label="Dash">
        <DashOptions style={style} onChange={onChange} />
      </StyleGroup>
      <div className="h-4 w-px shrink-0 bg-border" />
      <StyleGroup label="Opacity">
        <OpacityOptions style={style} onChange={onChange} />
      </StyleGroup>
    </div>
  );
}

export function StyleSheet({
  style,
  onChange,
}: {
  style: DrawStyle;
  onChange: (patch: Partial<DrawStyle>) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-2">
      <StyleGroup stacked label="Stroke colour">
        <StrokeSwatches style={style} onChange={onChange} />
      </StyleGroup>
      <StyleGroup stacked label="Fill">
        <FillSwatches style={style} onChange={onChange} />
      </StyleGroup>
      <StyleGroup stacked label="Width">
        <WidthOptions style={style} onChange={onChange} />
      </StyleGroup>
      <StyleGroup stacked label="Dash">
        <DashOptions style={style} onChange={onChange} />
      </StyleGroup>
      <StyleGroup stacked label="Opacity">
        <OpacityOptions style={style} onChange={onChange} />
      </StyleGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

export function TopBar({
  title,
  saveLabel,
  saveState,
  docOpen,
  onToggleDoc,
  paletteOpen,
  onTogglePalette,
  onExport,
  onNormalize,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  title: string;
  saveLabel: string;
  saveState: "saved" | "saving" | "failed" | "conflict";
  docOpen: boolean;
  onToggleDoc: () => void;
  paletteOpen: boolean;
  onTogglePalette: () => void;
  onExport: (format: "png" | "svg") => void;
  onNormalize: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const actionClass =
    "flex items-center gap-1 rounded px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <header className="flex shrink-0 touch-manipulation items-center gap-1 border-b border-border bg-background px-1.5 py-1 text-xs max-md:pl-[max(0.375rem,env(safe-area-inset-left))] max-md:pr-[max(0.375rem,env(safe-area-inset-right))] max-md:pt-[max(0.25rem,env(safe-area-inset-top))] md:gap-2 md:px-2 md:py-1.5">
      <Link
        to="/dashboard/draw"
        aria-label="Boards"
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded px-1.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground md:h-auto md:min-w-0 md:justify-start md:py-1"
        title="All boards"
      >
        <ChevronLeft className="h-4 w-4 md:h-3.5 md:w-3.5" />
        <span className="hidden md:inline">Boards</span>
      </Link>
      <div className="mx-1 hidden h-4 w-px bg-border md:block" />
      <button
        type="button"
        onClick={onTogglePalette}
        aria-pressed={paletteOpen}
        className={cn(
          "hidden items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors md:flex",
          paletteOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        title="Toggle shapes & icons"
      >
        <Boxes className="h-3.5 w-3.5" /> Insert
      </button>
      <span className="min-w-0 max-w-[16rem] truncate font-medium max-md:flex-1">{title}</span>
      <span
        className={cn(
          "shrink-0 text-muted-foreground max-md:text-[10px]",
          saveState === "conflict" && "text-amber-500",
          saveState === "failed" && "text-destructive",
        )}
      >
        {saveLabel}
      </span>
      <button
        type="button"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={onUndo}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 md:hidden"
      >
        <Undo2 className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={onRedo}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 md:hidden"
      >
        <Redo2 className="h-5 w-5" />
      </button>
      <div className="ml-auto hidden items-center gap-1 md:flex">
        <button
          type="button"
          onClick={onNormalize}
          title="Apply the clean architect style to every element on this board"
          className={actionClass}
        >
          <Sparkles className="h-3.5 w-3.5" /> Clean
        </button>
        <button type="button" onClick={() => onExport("png")} title="Export PNG" className={actionClass}>
          <Download className="h-3.5 w-3.5" /> PNG
        </button>
        <button type="button" onClick={() => onExport("svg")} title="Export SVG" className={actionClass}>
          <Download className="h-3.5 w-3.5" /> SVG
        </button>
        <button
          type="button"
          onClick={onToggleDoc}
          aria-pressed={docOpen}
          className={cn(
            "rounded px-2 py-1 font-medium transition-colors",
            docOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {docOpen ? "Hide notes" : "Notes"}
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 touch-manipulation">
          <DropdownMenuItem onSelect={onNormalize} className="h-11 gap-2">
            <Sparkles className="h-4 w-4" /> Clean
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport("png")} className="h-11 gap-2">
            <Download className="h-4 w-4" /> Export PNG
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport("svg")} className="h-11 gap-2">
            <Download className="h-4 w-4" /> Export SVG
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onToggleDoc} className="h-11 gap-2">
            {docOpen ? "Hide notes" : "Show notes"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
