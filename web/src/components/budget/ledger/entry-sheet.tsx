import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { CalendarDays, Plus, Repeat, X } from "lucide-react";
import { BottomSheet, Field, Pill, Segmented } from "./bottom-sheet";
import { categoryIcon, hueClasses } from "./chips";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError, useTags } from "@/hooks/use-budget";
import {
  ruleInput,
  useEntries,
  useEntryTags,
  useKindCategories,
  useSaveEntry,
  useSaveRule,
  tagsOf,
  type TagPick,
} from "@/hooks/use-ledger";
import {
  cadencePhrase,
  money,
  recents as recentsOf,
  signed,
  today,
  usualPriority,
  type Cadence,
  type Entry,
  type LedgerKind,
  type Priority,
  type Rule,
} from "@/lib/ledger";

export type SheetTarget = { mode: "new"; repeat?: boolean } | { mode: "edit"; entry: Entry } | { mode: "rule"; rule: Rule };

const CADENCES = ["daily", "weekly", "monthly", "yearly"] as const;
const PRIORITIES = ["need", "want", "savings"] as const;
const CURRENCIES = ["PHP", "USD", "JPY", "EUR"];

const yesterday = () => format(subDays(new Date(), 1), "yyyy-MM-dd");
const longDate = (d: string) => format(parseISO(d), "EEE, MMM d");

// EntrySheet adds an entry or a rule, or edits one. A new entry can be an
// expense or an income; turning Repeat on makes it a rule instead.
export function EntrySheet({
  kind: pageKind,
  target,
  onClose,
}: {
  kind: LedgerKind;
  target: SheetTarget | null;
  onClose: () => void;
}) {
  return (
    // A fresh form for each opening.
    target && <EntryForm key={JSON.stringify(target)} pageKind={pageKind} target={target} onClose={onClose} />
  );
}

function EntryForm({ pageKind, target, onClose }: { pageKind: LedgerKind; target: SheetTarget; onClose: () => void }) {
  const entry = target.mode === "edit" ? target.entry : undefined;
  const rule = target.mode === "rule" ? target.rule : undefined;
  const from = entry ?? rule;

  const [kind, setKind] = useState<LedgerKind>(from?.kind ?? pageKind);
  const [amount, setAmount] = useState(from ? String(from.amount) : "");
  const [currency, setCurrency] = useState(from?.currency ?? "PHP");
  const [description, setDescription] = useState(from?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | undefined>(from?.categoryId);
  const [date, setDate] = useState(entry?.date ?? rule?.startDate ?? today());
  const [priority, setPriority] = useState<Priority>(from?.priority ?? "want");
  const [notes, setNotes] = useState(from?.notes ?? "");
  const [showNotes, setShowNotes] = useState(!!from?.notes);
  const [repeat, setRepeat] = useState(!!rule || (target.mode === "new" && !!target.repeat));
  const [cadence, setCadence] = useState<Cadence>(rule?.cadence ?? "monthly");
  const [endDate, setEndDate] = useState<string | undefined>(rule?.endDate);
  const [tags, setTags] = useState<TagPick[] | null>(null);
  const [error, setError] = useState("");

  const { data: categories = [] } = useKindCategories(kind);
  const { data: entries = [] } = useEntries(kind);
  const { data: allTags = [] } = useTags();
  const tagIds = useEntryTags(kind);
  const hadTags = useMemo(() => (entry ? tagIds.get(entry.id) ?? [] : []), [entry, tagIds]);
  // The entry's tags arrive with the links; until the user changes them,
  // the sheet shows what the entry has.
  const shownTags: TagPick[] = tags ?? tagsOf(hadTags, allTags);

  const recents = useMemo(() => recentsOf(entries), [entries]);
  const usual = useMemo(() => usualPriority(entries), [entries]);
  const saveEntry = useSaveEntry(kind);
  const saveRule = useSaveRule(kind);
  const { showToast } = useToast();
  const busy = saveEntry.isPending || saveRule.isPending;

  const isNew = target.mode === "new";
  const value = Number(amount.replace(/,/g, ""));
  const valid = value > 0 && description.trim() !== "" && (!endDate || endDate >= date);
  const expense = kind === "expense";

  const pickCategory = (id: string | undefined) => {
    setCategoryId(id);
    if (id && usual.has(id)) setPriority(usual.get(id)!);
  };

  const switchKind = (k: LedgerKind) => {
    if (k === kind) return;
    setKind(k);
    setCategoryId(undefined);
    setTags([]);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setError("");
    try {
      if (repeat) {
        const input = {
          description: description.trim(),
          amount: value,
          currency,
          category_id: categoryId,
          notes: notes.trim() || undefined,
          priority,
          recurring_type: cadence,
          start_date: date,
          end_date: endDate,
        };
        await saveRule.mutateAsync(rule ? { id: rule.id, rule: ruleInput(rule, input) } : { rule: input });
        showToast(rule ? "Rule saved" : `Rule added: ${money(value, currency)} ${cadencePhrase(cadence, date)}`, "success");
      } else {
        await saveEntry.mutateAsync({
          id: entry?.id,
          input: {
            description: description.trim(),
            amount: value,
            currency,
            date,
            categoryId,
            priority,
            notes: notes.trim(),
            marker: entry?.marker,
            // An edited entry keeps its status unless its new date says
            // otherwise.
            status: entry && entry.status === "skipped" ? "skipped" : undefined,
            ruleId: entry?.ruleId,
          },
          tags: tags ?? undefined,
          hadTags,
        });
        showToast(entry ? "Saved" : `${expense ? "Expense" : "Income"} added${kind !== pageKind ? ` to ${expense ? "Expenses" : "Incomes"}` : ""}`, "success");
      }
      onClose();
    } catch (e) {
      setError(e instanceof GuestBlockedError ? e.message : `Couldn't save: ${(e as Error).message}`);
    }
  };

  const accent = expense ? "bg-primary text-primary-foreground" : "bg-emerald-400 text-emerald-950";
  const saveLabel = rule
    ? "Save rule"
    : entry
      ? "Save changes"
      : repeat
        ? `Add ${kind} rule${value > 0 ? ` · ${signed(kind, value, currency)} ${cadence}` : ""}`
        : `Add ${kind}${value > 0 ? ` · ${signed(kind, value, currency)}` : ""}`;

  const title = rule ? `Edit rule: ${rule.description}` : entry ? `Edit ${kind}` : `New ${kind}`;

  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      header={
        <div className="flex items-center justify-between">
          <button type="button" onClick={onClose} className="h-9 w-16 text-left text-[15px] font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          {isNew ? (
            <div role="radiogroup" aria-label="Kind" className="flex rounded-full bg-muted p-[3px]">
              {(["expense", "income"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => switchKind(k)}
                  className={cn(
                    "min-h-8 rounded-full px-4 text-[13px] font-semibold transition-colors",
                    kind === k ? (k === "expense" ? "bg-primary text-primary-foreground" : "bg-emerald-400 text-emerald-950") : "text-muted-foreground",
                  )}
                >
                  {k === "expense" ? "Expense" : "Income"}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[15px] font-semibold">{rule ? "Edit rule" : `Edit ${kind}`}</p>
          )}
          <span className="w-16" />
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            className={cn("min-h-[52px] w-full rounded-2xl text-base font-semibold transition-opacity disabled:opacity-40", accent)}
          >
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      }
    >
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Amount */}
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <label htmlFor="entry-amount" className="sr-only">
            Amount
          </label>
          <div className="flex items-baseline justify-center gap-1">
            <span className="font-mono text-2xl text-muted-foreground">{expense ? "−" : "+"}{money(0, currency).replace("0", "")}</span>
            <input
              id="entry-amount"
              inputMode="decimal"
              autoComplete="off"
              autoFocus={isNew}
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              className="min-w-0 bg-transparent text-left font-mono text-[44px] font-medium tracking-tight text-foreground caret-primary outline-none placeholder:text-foreground/25"
              style={{ width: `${Math.max(1, amount.length) + 0.4}ch` }}
            />
          </div>
          <label className="sr-only" htmlFor="entry-currency">
            Currency
          </label>
          <select
            id="entry-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-7 rounded-full border border-foreground/12 bg-transparent px-2.5 text-xs font-medium text-muted-foreground"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c} className="bg-popover">
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <Field label={expense ? "What was it?" : "Where from?"} htmlFor="entry-description">
          <input
            id="entry-description"
            autoComplete="off"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={expense ? "e.g. lunch, bus, spotify" : "e.g. salary, baon"}
            className="min-h-12 rounded-2xl border border-foreground/12 bg-background px-3.5 text-base text-foreground outline-none placeholder:text-foreground/30 focus:border-primary/60"
          />
          {isNew && recents.length > 0 && !description && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground/70">Recent</span>
              {recents.map((r) => (
                <button
                  key={r.description}
                  type="button"
                  onClick={() => {
                    setDescription(r.description);
                    setAmount(String(r.amount));
                    setCategoryId(r.categoryId);
                    setPriority(r.priority);
                  }}
                  className="h-7 rounded-full bg-muted px-2.5 text-[13px] font-medium text-foreground/85 hover:bg-muted/70"
                >
                  {r.description}
                </button>
              ))}
            </div>
          )}
        </Field>

        {/* Category */}
        <Field label="Category">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
            {categories
              .filter((c) => c.is_active !== false || c.id === categoryId)
              .map((c) => {
                const Icon = categoryIcon(c);
                const on = c.id === categoryId;
                const hue = hueClasses(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pickCategory(on ? undefined : c.id)}
                    className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium", hue.chip, on && cn("ring-2", hue.ring))}
                  >
                    <Icon className="h-[15px] w-[15px]" aria-hidden />
                    {c.name}
                  </button>
                );
              })}
            {categories.length === 0 && <span className="text-sm text-muted-foreground">No categories yet. Add them in Budget settings.</span>}
          </div>
        </Field>

        {/* Date */}
        <Field label={repeat ? "Starts" : "Date"}>
          <div className="flex flex-wrap gap-2">
            <Pill on={date === today()} onClick={() => setDate(today())}>
              Today
            </Pill>
            <Pill on={date === yesterday()} onClick={() => setDate(yesterday())}>
              Yesterday
            </Pill>
            <DatePill value={date} onChange={setDate} on={date !== today() && date !== yesterday()} />
          </div>
        </Field>

        {/* Priority */}
        <Field label="Priority">
          <Segmented label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} />
        </Field>

        {/* Tags: they go on single entries, not rules. */}
        {!repeat && <TagField tags={shownTags} allTags={allTags} onChange={setTags} />}

        {/* Repeat */}
        {(isNew || rule) &&
          (repeat ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/[0.07] p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[15px] font-medium text-[#f4a084]">
                  <Repeat className="h-4 w-4" aria-hidden />
                  Repeats
                </span>
                {!rule && <Switch on label="Repeat" onChange={() => setRepeat(false)} />}
              </div>
              <Segmented label="How often" options={CADENCES} value={cadence} onChange={setCadence} activeClass="bg-primary text-primary-foreground" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">Ends</span>
                <Pill on={!endDate} onClick={() => setEndDate(undefined)}>
                  Never
                </Pill>
                <DatePill value={endDate} onChange={setEndDate} on={!!endDate} placeholder="On a date" min={date} />
              </div>
              <p className="text-[13px] leading-relaxed text-foreground/85">
                {rule ? (
                  <>Changes apply from the next entry on; the entries it already made stay as they are.</>
                ) : (
                  <>
                    Makes a rule:{" "}
                    <b className="font-semibold text-foreground">
                      {value > 0 ? money(value, currency) : "this amount"} {cadencePhrase(cadence, date)}
                    </b>
                    , starting {longDate(date)}
                    {endDate ? ` until ${longDate(endDate)}` : ""}. Each one shows up under Rules and in the Feed on its day.
                  </>
                )}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRepeat(true)}
              className="flex min-h-[52px] items-center justify-between rounded-2xl border border-foreground/10 bg-background px-3.5 text-left text-[15px] font-medium"
            >
              <span className="flex items-center gap-2.5">
                <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden />
                Repeat
              </span>
              <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                Doesn't repeat
                <Switch on={false} label="Repeat" />
              </span>
            </button>
          ))}

        {/* Note */}
        {showNotes ? (
          <Field label="Note" htmlFor="entry-notes">
            <textarea
              id="entry-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-2xl border border-foreground/12 bg-background px-3.5 py-2.5 text-[15px] outline-none focus:border-primary/60"
            />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowNotes(true)} className="self-start text-sm font-medium text-muted-foreground hover:text-foreground">
            + Add a note
          </button>
        )}
        <button type="submit" hidden />
      </form>
    </BottomSheet>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange?: () => void }) {
  const knob = (
    <span className={cn("relative h-6 w-[42px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-stone-700")}>
      <span className={cn("absolute top-[3px] h-[18px] w-[18px] rounded-full transition-all", on ? "right-[3px] bg-background" : "left-[3px] bg-muted-foreground")} />
    </span>
  );
  // Inside a button the whole row toggles; alone it is its own switch.
  return onChange ? (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange}>
      {knob}
    </button>
  ) : (
    <span role="presentation">{knob}</span>
  );
}

// DatePill is a pill that opens the device's date picker.
function DatePill({
  value,
  onChange,
  on,
  placeholder = "Pick a date",
  min,
}: {
  value?: string;
  onChange: (d: string) => void;
  on: boolean;
  placeholder?: string;
  min?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span
      className={cn(
        "relative inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm",
        on ? "bg-foreground font-semibold text-background" : "border border-foreground/15 font-medium",
      )}
    >
      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      {on && value ? longDate(value) : placeholder}
      <input
        ref={ref}
        type="date"
        aria-label={placeholder}
        value={value ?? ""}
        min={min}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={() => {
          try {
            ref.current?.showPicker?.();
          } catch {
            /* the browser opens it itself */
          }
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </span>
  );
}

function TagField({ tags, allTags, onChange }: { tags: TagPick[]; allTags: { id: string; name: string }[]; onChange: (t: TagPick[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const name = text.trim().replace(/^#/, "");
  const has = (n: string) => tags.some((t) => t.name.toLowerCase() === n.toLowerCase());
  const matches = allTags.filter((t) => !has(t.name) && t.name.toLowerCase().includes(name.toLowerCase())).slice(0, 6);
  const add = (t: TagPick) => {
    if (!has(t.name)) onChange([...tags, t]);
    setText("");
  };

  return (
    <Field label="Tags">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t.name} className="inline-flex h-[30px] items-center gap-1 rounded-full border border-pink-300/40 pl-2.5 pr-1 text-[13px] font-medium text-pink-200">
            #{t.name}
            <button type="button" aria-label={`Remove #${t.name}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="grid h-6 w-6 place-items-center rounded-full opacity-70 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            ref={inputRef}
            value={text}
            placeholder="tag name"
            aria-label="New tag"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name) add(allTags.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? { name });
              } else if (e.key === "Escape") {
                setAdding(false);
              }
            }}
            onBlur={() => !text && setAdding(false)}
            className="h-[30px] w-32 rounded-full border border-foreground/20 bg-background px-3 text-[13px] outline-none focus:border-pink-300/60"
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-[30px] items-center gap-1 rounded-full border border-dashed border-foreground/25 px-2.5 text-[13px] font-medium text-muted-foreground">
            <Plus className="h-3 w-3" /> Tag
          </button>
        )}
      </div>
      {adding && (matches.length > 0 || (name && !has(name))) && (
        <div className="flex flex-wrap gap-1.5">
          {matches.map((t) => (
            <button key={t.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)} className="h-7 rounded-full bg-muted px-2.5 text-[13px] text-pink-200">
              #{t.name}
            </button>
          ))}
          {name && !allTags.some((t) => t.name.toLowerCase() === name.toLowerCase()) && !has(name) && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add({ name })} className="h-7 rounded-full border border-dashed border-pink-300/40 px-2.5 text-[13px] text-pink-200">
              Create #{name}
            </button>
          )}
        </div>
      )}
    </Field>
  );
}
