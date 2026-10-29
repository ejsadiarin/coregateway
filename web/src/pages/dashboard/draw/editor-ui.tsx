// Editor chrome for coredraw — an eraser.io-inspired left rail + searchable
// left palette over the Excalidraw canvas.
//
// This module is engine-agnostic: it renders and reports intent through
// callbacks, and never imports the drawing engine. The page wires those
// callbacks to the canvas adapter.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, ChevronLeft, Download, Layers, Search, Shapes, Sparkles, X } from "lucide-react";
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

function RailButton({
  active,
  title,
  hint,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={hint ? `${title} (${hint})` : title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
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
}: {
  activeTool: RailToolId | null;
  onSelectTool: (id: RailToolId) => void;
  paletteOpen: boolean;
  paletteTab: PaletteTab;
  onOpenPalette: (tab: PaletteTab) => void;
}) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
      {RAIL_TOOLS.map((t) => (
        <RailButton
          key={t.id}
          title={t.title}
          hint={t.hint}
          active={activeTool === t.id}
          onClick={() => onSelectTool(t.id)}
        >
          <t.icon className="h-[18px] w-[18px]" />
        </RailButton>
      ))}

      <div className="my-1 h-px w-6 bg-border" />

      <RailButton
        title="Shapes"
        active={paletteOpen && paletteTab === "shapes"}
        onClick={() => onOpenPalette("shapes")}
      >
        <Shapes className="h-[18px] w-[18px]" />
      </RailButton>
      <RailButton
        title="Icons"
        active={paletteOpen && paletteTab === "icons"}
        onClick={() => onOpenPalette("icons")}
      >
        <Layers className="h-[18px] w-[18px]" />
      </RailButton>
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
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string>("all");
  // Index into `results` for the keyboard highlight; -1 means nothing is
  // highlighted (empty query), so Enter cannot insert an arbitrary first icon.
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => clearTimeout(t);
    }
  }, [open, focusNonce]);

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

  if (!open) return null;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-background">
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

function StyleGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
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
      className={cn(
        "h-4 w-4 rounded-full border transition-transform",
        active ? "border-foreground ring-2 ring-foreground/40" : "border-border hover:scale-110",
      )}
      style={{
        background: transparent
          ? "repeating-linear-gradient(45deg, transparent 0 3px, #a8a29e 3px 4px)"
          : value,
      }}
    />
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
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-2 py-1">
      <StyleGroup label="Stroke">
        {STROKE_COLORS.map((color) => (
          <Swatch
            key={color.value}
            name={color.name}
            value={color.value}
            active={style.strokeColor === color.value}
            onClick={() => onChange({ strokeColor: color.value })}
          />
        ))}
      </StyleGroup>

      <div className="h-4 w-px shrink-0 bg-border" />

      <StyleGroup label="Fill">
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
      </StyleGroup>

      <div className="h-4 w-px shrink-0 bg-border" />

      <StyleGroup label="Width">
        {STROKE_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            title={`${width}px stroke`}
            aria-label={`${width}px stroke`}
            aria-pressed={style.strokeWidth === width}
            onClick={() => onChange({ strokeWidth: width })}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded border transition-colors",
              style.strokeWidth === width
                ? "border-foreground/40 bg-muted text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/60",
            )}
          >
            <span className="block w-3.5 rounded-full bg-current" style={{ height: width }} />
          </button>
        ))}
      </StyleGroup>

      <div className="h-4 w-px shrink-0 bg-border" />

      <StyleGroup label="Dash">
        {STROKE_STYLES.map((item) => (
          <button
            key={item.value}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-pressed={style.strokeStyle === item.value}
            onClick={() => onChange({ strokeStyle: item.value })}
            className={cn(
              "flex h-6 w-7 items-center justify-center rounded border transition-colors",
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
      </StyleGroup>

      <div className="h-4 w-px shrink-0 bg-border" />

      <StyleGroup label="Opacity">
        {OPACITIES.map((opacity) => (
          <button
            key={opacity}
            type="button"
            title={`${opacity}% opacity`}
            aria-label={`${opacity}% opacity`}
            aria-pressed={style.opacity === opacity}
            onClick={() => onChange({ opacity })}
            className={cn(
              "flex h-6 items-center justify-center rounded border px-1.5 text-[10px] transition-colors",
              style.opacity === opacity
                ? "border-foreground/40 bg-muted text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/60",
            )}
          >
            {opacity}%
          </button>
        ))}
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
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-1.5 text-xs">
      <Link
        to="/dashboard/draw"
        className="flex items-center gap-1 rounded px-1.5 py-1 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        title="All boards"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Boards
      </Link>
      <div className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onTogglePalette}
        aria-pressed={paletteOpen}
        className={cn(
          "flex items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors",
          paletteOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        title="Toggle shapes & icons"
      >
        <Boxes className="h-3.5 w-3.5" /> Insert
      </button>
      <span className="max-w-[16rem] truncate font-medium">{title}</span>
      <span
        className={cn(
          "text-muted-foreground",
          saveState === "conflict" && "text-amber-500",
          saveState === "failed" && "text-destructive",
        )}
      >
        {saveLabel}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onNormalize}
          title="Apply the clean architect style to every element on this board"
          className="flex items-center gap-1 rounded px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Sparkles className="h-3.5 w-3.5" /> Clean
        </button>
        <button
          type="button"
          onClick={() => onExport("png")}
          title="Export PNG"
          className="flex items-center gap-1 rounded px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" /> PNG
        </button>
        <button
          type="button"
          onClick={() => onExport("svg")}
          title="Export SVG"
          className="flex items-center gap-1 rounded px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
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
    </header>
  );
}
