// Editor chrome for coredraw — an eraser.io-inspired left rail + searchable
// left palette, with tldraw's default toolbar/menu chrome hidden (see
// TLDRAW_COMPONENTS in page.tsx).
//
// The rail switches tools; the palette inserts shapes and icons. Icons render
// from the vendored sprite and always carry a caption under them on canvas.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useValue, type Editor } from "tldraw";
import { Boxes, ChevronLeft, Layers, Search, Shapes, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_FAMILIES, ICON_ENTRIES, type IconEntry } from "@/pages/dashboard/draw/icon-catalog";
import { IconGlyph, insertIcon } from "@/pages/dashboard/draw/icon-shape";
import { RAIL_TOOLS, SHAPE_ITEMS, type ShapeItem } from "@/pages/dashboard/draw/palette-catalog";

export type PaletteTab = "icons" | "shapes";

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
  editor,
  paletteOpen,
  paletteTab,
  onOpenPalette,
}: {
  editor: Editor | null;
  paletteOpen: boolean;
  paletteTab: PaletteTab;
  onOpenPalette: (tab: PaletteTab) => void;
}) {
  const currentTool = useValue(
    "current tool",
    () => editor?.getCurrentToolId() ?? "select",
    [editor],
  );

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
      {RAIL_TOOLS.map((t) => (
        <RailButton
          key={t.id}
          title={t.title}
          hint={t.hint}
          active={currentTool === t.tool}
          onClick={() => editor?.setCurrentTool(t.tool)}
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

function IconTile({ entry, onPick }: { entry: IconEntry; onPick: () => void }) {
  return (
    <button
      type="button"
      title={`${entry.title} (${entry.familyLabel} · ${entry.category})`}
      onClick={onPick}
      className="group flex flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-center transition-colors hover:border-border hover:bg-accent"
    >
      <span className="flex h-8 w-8 items-center justify-center text-foreground">
        <IconGlyph iconId={entry.id} label={entry.title} />
      </span>
      <span className="w-full truncate text-[10px] leading-tight text-muted-foreground group-hover:text-foreground">
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
      className="group flex flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-center transition-colors hover:border-border hover:bg-accent"
    >
      <span className="flex h-8 w-8 items-center justify-center">
        <item.icon className="h-5 w-5 text-foreground/80 group-hover:text-foreground" />
      </span>
      <span className="w-full truncate text-[10px] leading-tight text-muted-foreground group-hover:text-foreground">
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
  editor,
  tab,
  onTabChange,
  onClose,
}: {
  open: boolean;
  editor: Editor | null;
  tab: PaletteTab;
  onTabChange: (tab: PaletteTab) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

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

  if (!open) return null;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
        <button
          type="button"
          onClick={() => onTabChange("icons")}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium",
            tab === "icons" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          <Layers className="h-3.5 w-3.5" /> Icons
        </button>
        <button
          type="button"
          onClick={() => onTabChange("shapes")}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium",
            tab === "shapes" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          <Shapes className="h-3.5 w-3.5" /> Shapes
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
          <div className="shrink-0 border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search icons…"
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            {tokens.length === 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {[{ id: "all", label: "All" }, ...ICON_FAMILIES.map((f) => ({ id: f.id, label: f.label }))].map(
                  (f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFamily(f.id)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                        family === f.id
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {f.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
                          {entries.map((entry) => (
                            <IconTile
                              key={entry.id}
                              entry={entry}
                              onPick={() => editor && insertIcon(editor, entry.id, entry.title)}
                            />
                          ))}
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
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-4 gap-0.5">
            {SHAPE_ITEMS.map((item) => (
              <ShapeTile key={item.id} item={item} onPick={() => editor && item.run(editor)} />
            ))}
          </div>
        </div>
      )}
    </aside>
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
}: {
  title: string;
  saveLabel: string;
  saveState: "saved" | "saving" | "failed" | "conflict";
  docOpen: boolean;
  onToggleDoc: () => void;
  paletteOpen: boolean;
  onTogglePalette: () => void;
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
      <button
        type="button"
        onClick={onToggleDoc}
        aria-pressed={docOpen}
        className={cn(
          "ml-auto rounded px-2 py-1 font-medium transition-colors",
          docOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {docOpen ? "Hide notes" : "Notes"}
      </button>
    </header>
  );
}
