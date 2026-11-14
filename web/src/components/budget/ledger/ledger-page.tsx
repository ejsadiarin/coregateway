import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronDown, ListFilter, Plus, Repeat, X } from "lucide-react";
import { BottomSheet } from "./bottom-sheet";
import { CategoryBadge, CategoryChip, NeedChip, RuleChip, StatusChip, TagChip, categoryIcon, hueClasses } from "./chips";
import { EntryDetails } from "./entry-details";
import { EntrySheet, type SheetTarget } from "./entry-sheet";
import { RuleSheet } from "./rule-sheet";
import { cn } from "@/lib/utils";
import { useTags } from "@/hooks/use-budget";
import { tagsOf, useEntries, useEntryTags, useKindCategories, useRules } from "@/hooks/use-ledger";
import {
  applyFilter,
  byMonth,
  cadenceLabel,
  counted,
  ended,
  money,
  nextDue,
  ruleTotals,
  signed,
  splitUpcoming,
  type Entry,
  type Filter,
  type LedgerKind,
  type Rule,
  type Source,
} from "@/lib/ledger";
import type { Category, Tag } from "@/types/api";

// How many months open by default; older ones open on a tap.
const OPEN_MONTHS = 2;
const NO_ENTRIES: Entry[] = [];
const NO_RULES: Rule[] = [];

// LedgerPage is the Expenses page and the Incomes page: the rules, what is
// coming up, then every entry by month and day.
export function LedgerPage({ kind }: { kind: LedgerKind }) {
  const entriesQ = useEntries(kind);
  const rulesQ = useRules(kind);
  const { data: categories = [] } = useKindCategories(kind);
  const { data: tags = [] } = useTags();
  const tagIds = useEntryTags(kind);

  const [filter, setFilter] = useState<Filter>({ source: "all" });
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [pickCategory, setPickCategory] = useState(false);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const entries = entriesQ.data ?? NO_ENTRIES;
  const rules = rulesQ.data ?? NO_RULES;
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const ruleById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);

  // What each rule has made, and the date it makes the next one.
  const madeBy = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) if (e.ruleId) m.set(e.ruleId, [...(m.get(e.ruleId) ?? []), e]);
    return m;
  }, [entries]);
  const nextOf = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const r of rules) m.set(r.id, nextDue(r, new Set((madeBy.get(r.id) ?? []).map((e) => e.date))));
    return m;
  }, [rules, madeBy]);

  const shownRules = useMemo(
    () =>
      rules
        .filter((r) => !ended(r))
        .sort((a, b) => Number(b.active) - Number(a.active) || (nextOf.get(a.id) ?? "9").localeCompare(nextOf.get(b.id) ?? "9")),
    [rules, nextOf],
  );
  const totals = ruleTotals(shownRules.filter((r) => r.active));

  const { upcoming, past } = useMemo(() => splitUpcoming(entries), [entries]);
  const months = useMemo(() => byMonth(applyFilter(past, filter)), [past, filter]);

  const isOpen = (key: string, i: number) => toggled[key] ?? i < OPEN_MONTHS;
  const noun = kind === "expense" ? "Expense" : "Income";
  const plural = kind === "expense" ? "Expenses" : "Incomes";
  const filterCategory = filter.categoryId ? categoryById.get(filter.categoryId) : undefined;

  const entry = openEntry ? entries.find((e) => e.id === openEntry) : undefined;
  const rule = openRule ? ruleById.get(openRule) : undefined;

  const rowProps = (e: Entry) => ({
    entry: e,
    category: e.categoryId ? categoryById.get(e.categoryId) : undefined,
    tags: tagsOf(tagIds.get(e.id), tags),
    rule: e.ruleId ? ruleById.get(e.ruleId) : undefined,
    onOpen: () => setOpenEntry(e.id),
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col pb-28">
      <header className="flex items-center justify-between gap-3 px-4 pt-5 pb-3.5">
        <h1 className="text-3xl font-semibold tracking-tight">{plural}</h1>
        <nav aria-label="Budget lists" className="flex rounded-full bg-muted p-[3px]">
          {(["expense", "income"] as const).map((k) => (
            <Link
              key={k}
              to={`/dashboard/budget/${k}s`}
              aria-current={k === kind ? "page" : undefined}
              className={cn(
                "flex min-h-[34px] items-center rounded-full px-3.5 text-[13px] transition-colors",
                k === kind ? (k === "expense" ? "bg-primary font-semibold text-primary-foreground" : "bg-emerald-400 font-semibold text-emerald-950") : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "expense" ? "Expenses" : "Incomes"}
            </Link>
          ))}
        </nav>
      </header>

      {/* Rules */}
      <section aria-labelledby="rules-h" className="flex flex-col gap-2.5 pt-1 pb-2">
        <div className="flex items-baseline justify-between px-5">
          <h2 id="rules-h" className="text-[15px] font-semibold text-foreground/85">
            Rules {shownRules.length > 0 && <span className="font-normal text-muted-foreground">· {shownRules.filter((r) => r.active).length} active</span>}
          </h2>
          {(totals.perMonth > 0 || totals.perYear > 0) && (
            <span className="text-[13px] text-muted-foreground">
              {[totals.perMonth && `${money(totals.perMonth)}/mo`, totals.perYear && `${money(totals.perYear)}/yr`].filter(Boolean).join(" + ")}
            </span>
          )}
        </div>
        <div className="flex gap-2.5 overflow-x-auto px-4 pb-1">
          {rulesQ.isLoading && [0, 1].map((i) => <div key={i} className="h-[104px] w-[156px] shrink-0 animate-pulse rounded-2xl bg-muted/60" />)}
          {shownRules.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOpenRule(r.id)}
              className={cn(
                "flex w-[168px] shrink-0 flex-col gap-2 rounded-2xl border border-foreground/[0.09] bg-popover p-3.5 text-left transition-colors hover:border-foreground/20",
                !r.active && "opacity-60",
              )}
            >
              <span className="flex items-start gap-1.5 text-sm font-semibold leading-snug">
                <Repeat className={cn("mt-[3px] h-3.5 w-3.5 shrink-0", r.active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="line-clamp-2">{r.description}</span>
              </span>
              <span className="font-mono text-[17px]">{money(r.amount, r.currency)}</span>
              <span className="mt-auto text-[13px] text-muted-foreground">
                {r.active ? (
                  <>
                    {cadenceLabel(r.cadence)}
                    {nextOf.get(r.id) && (
                      <>
                        {" "}
                        · next <span className="whitespace-nowrap text-foreground">{format(parseISO(nextOf.get(r.id)!), "MMM d")}</span>
                      </>
                    )}
                  </>
                ) : (
                  "Paused"
                )}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSheet({ mode: "new", repeat: true })}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-foreground/20 text-sm font-medium text-muted-foreground hover:text-foreground",
              shownRules.length ? "w-24" : "min-h-[72px] flex-1 flex-row gap-2",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {shownRules.length ? "Rule" : `Add a rule for ${kind === "expense" ? "bills and subscriptions" : "a regular income"}`}
          </button>
        </div>
      </section>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-h" className="flex flex-col gap-2.5 px-4 pt-3.5 pb-1">
          <h2 id="upcoming-h" className="px-1 text-[15px] font-semibold text-foreground/85">
            Upcoming
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((e) => {
              const c = e.categoryId ? categoryById.get(e.categoryId) : undefined;
              const r = e.ruleId ? ruleById.get(e.ruleId) : undefined;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenEntry(e.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border border-dashed border-accent/45 bg-accent/[0.06] p-3.5 text-left",
                    e.status === "skipped" && "opacity-60",
                  )}
                >
                  <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-accent/15 leading-none">
                    <span className="text-[11px] font-semibold text-accent">{format(parseISO(e.date), "MMM")}</span>
                    <span className="text-[17px] font-semibold">{format(parseISO(e.date), "d")}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="truncate text-[15px] font-medium">{e.description}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <CategoryChip category={c} />
                      {r && <RuleChip>{r.description}</RuleChip>}
                      <StatusChip status={e.status === "skipped" ? "skipped" : "pending"} />
                    </span>
                  </span>
                  <span className={cn("font-mono text-[15px]", e.status === "skipped" && "line-through")}>{signed(kind, e.amount, e.currency)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-1">
        <div role="radiogroup" aria-label="Made by" className="flex min-w-0 flex-1 rounded-full border border-foreground/[0.08] bg-popover p-[3px]">
          {(
            [
              ["all", "All"],
              ["rule", "From a rule"],
              ["hand", "By hand"],
            ] as [Source, string][]
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={filter.source === s}
              onClick={() => setFilter((f) => ({ ...f, source: s }))}
              className={cn(
                "min-h-8 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors",
                s === "all" ? "shrink-0" : "flex-1",
                filter.source === s ? "bg-foreground font-semibold text-background" : "font-medium text-foreground/80",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {filterCategory ? (
          <span className={cn("inline-flex h-[38px] shrink-0 items-center gap-1 rounded-full pl-3 pr-1 text-[13px] font-medium", hueClasses(filterCategory).chip)}>
            <button type="button" onClick={() => setPickCategory(true)} className="max-w-[7rem] truncate">
              {filterCategory.name}
            </button>
            <button type="button" aria-label="Show every category" onClick={() => setFilter((f) => ({ ...f, categoryId: undefined }))} className="grid h-7 w-7 place-items-center rounded-full">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setPickCategory(true)}
            className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-full border border-foreground/[0.14] bg-popover px-3 text-[13px] font-medium"
          >
            <ListFilter className="h-[15px] w-[15px]" aria-hidden />
            Category
          </button>
        )}
      </div>

      {/* Months */}
      {entriesQ.isLoading && (
        <div className="flex flex-col gap-2 px-3 pt-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/50" />
          ))}
        </div>
      )}
      {entriesQ.isError && (
        <p role="alert" className="px-5 pt-6 text-sm text-destructive">
          Couldn't load {plural.toLowerCase()}: {(entriesQ.error as Error).message}
        </p>
      )}
      {!entriesQ.isLoading && !entriesQ.isError && months.length === 0 && (
        <p className="px-5 pt-8 text-center text-sm text-muted-foreground">
          {entries.length ? "Nothing matches these filters." : `No ${plural.toLowerCase()} yet. Add your first with the button below.`}
        </p>
      )}
      {months.map((m, i) => {
        const open = isOpen(m.key, i);
        return (
          <section key={m.key} aria-label={format(parseISO(`${m.key}-01`), "MMMM yyyy")} className={cn(i > 0 && "mt-3")}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setToggled((t) => ({ ...t, [m.key]: !open }))}
              className="sticky top-0 z-10 flex w-full items-center justify-between gap-3 bg-background/95 px-5 pt-4 pb-2.5 text-left backdrop-blur"
            >
              <h2 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
                {format(parseISO(`${m.key}-01`), "MMMM yyyy")}
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
              </h2>
              <span className="text-[13px] text-muted-foreground">
                <span className="font-mono text-foreground">{signed(kind, m.total)}</span> · {m.count} {m.count === 1 ? "entry" : "entries"}
              </span>
            </button>
            {open &&
              m.days.map((d) => (
                <div key={d.date}>
                  <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
                    <span className="text-sm font-semibold text-foreground/80">{format(parseISO(d.date), "EEEE, MMM d")}</span>
                    <span className="font-mono text-[13px] text-muted-foreground">{signed(kind, d.total)}</span>
                  </div>
                  <ul className="mx-3 overflow-hidden rounded-2xl border border-foreground/[0.07] bg-popover">
                    {d.entries.map((e) => (
                      <li key={e.id} className="border-b border-foreground/[0.06] last:border-b-0">
                        <EntryRow {...rowProps(e)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        );
      })}

      <button
        type="button"
        onClick={() => setSheet({ mode: "new" })}
        className={cn(
          "fixed right-4 bottom-20 z-30 flex min-h-[52px] items-center gap-1.5 rounded-full px-5 text-[15px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.45)] md:bottom-8 md:right-8",
          kind === "expense" ? "bg-primary text-primary-foreground" : "bg-emerald-400 text-emerald-950",
        )}
      >
        <Plus className="h-[18px] w-[18px]" aria-hidden />
        {noun}
      </button>

      <EntrySheet kind={kind} target={sheet} onClose={() => setSheet(null)} />

      {entry && (
        <EntryDetails
          entry={entry}
          category={entry.categoryId ? categoryById.get(entry.categoryId) : undefined}
          tags={tagsOf(tagIds.get(entry.id), tags)}
          rule={entry.ruleId ? ruleById.get(entry.ruleId) : undefined}
          onClose={() => setOpenEntry(null)}
          onEdit={() => {
            setOpenEntry(null);
            setSheet({ mode: "edit", entry });
          }}
          onOpenRule={(r) => {
            setOpenEntry(null);
            setOpenRule(r.id);
          }}
        />
      )}

      {rule && (
        <RuleSheet
          rule={rule}
          made={madeBy.get(rule.id) ?? []}
          next={nextOf.get(rule.id)}
          category={rule.categoryId ? categoryById.get(rule.categoryId) : undefined}
          onClose={() => setOpenRule(null)}
          onEdit={() => {
            setOpenRule(null);
            setSheet({ mode: "rule", rule });
          }}
          onOpenEntry={(e) => {
            setOpenRule(null);
            setOpenEntry(e.id);
          }}
        />
      )}

      {pickCategory && (
        <BottomSheet open onOpenChange={(o) => !o && setPickCategory(false)} title="Filter by category" header={<p className="text-[15px] font-semibold">Show one category</p>}>
          <div className="flex flex-wrap gap-2 pb-2">
            {categories.map((c) => (
              <CategoryOption
                key={c.id}
                category={c}
                on={c.id === filter.categoryId}
                count={past.filter((e) => e.categoryId === c.id && counted(e)).length}
                onPick={() => {
                  setFilter((f) => ({ ...f, categoryId: c.id === f.categoryId ? undefined : c.id }));
                  setPickCategory(false);
                }}
              />
            ))}
            {categories.length === 0 && <p className="text-sm text-muted-foreground">No categories yet.</p>}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function CategoryOption({ category, on, count, onPick }: { category: Category; on: boolean; count: number; onPick: () => void }) {
  const Icon = categoryIcon(category);
  const hue = hueClasses(category);
  return (
    <button type="button" aria-pressed={on} onClick={onPick} className={cn("inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium", hue.chip, on && cn("ring-2", hue.ring))}>
      <Icon className="h-4 w-4" aria-hidden />
      {category.name}
      <span className="text-xs opacity-70">{count}</span>
    </button>
  );
}

function EntryRow({ entry, category, tags, rule, onOpen }: { entry: Entry; category?: Category; tags: Tag[]; rule?: Rule; onOpen: () => void }) {
  const skipped = entry.status === "skipped";
  return (
    <button type="button" onClick={onOpen} className={cn("flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.03]", skipped && "opacity-55")}>
      <CategoryBadge category={category} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-[15px] font-medium text-foreground">{entry.description || "(no description)"}</span>
        <span className="flex flex-wrap gap-1.5">
          <CategoryChip category={category} />
          {rule && (
            <RuleChip>
              {cadenceLabel(rule.cadence)} · {rule.description}
            </RuleChip>
          )}
          {tags.map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
          {entry.priority === "need" && <NeedChip />}
          {skipped && <StatusChip status="skipped" />}
        </span>
      </span>
      <span className={cn("font-mono text-[15px] tabular-nums text-foreground", skipped && "line-through")}>{signed(entry.kind, entry.amount, entry.currency)}</span>
    </button>
  );
}
