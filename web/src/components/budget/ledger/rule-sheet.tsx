import { useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { Repeat } from "lucide-react";
import { BottomSheet } from "./bottom-sheet";
import { CategoryChip, NeedChip } from "./chips";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError } from "@/hooks/use-budget";
import { ruleInput, useDeleteEntry, useSaveEntry, useSaveRule } from "@/hooks/use-ledger";
import { cadencePhrase, counted, ended, money, signed, today, type Entry, type Rule } from "@/lib/ledger";
import type { Category } from "@/types/api";

const short = (d: string) => format(parseISO(d), "MMM d");
const long = (d: string) => format(parseISO(d), "MMM d, yyyy");

// RuleSheet shows a rule, what it has made and what comes next, with the
// ways to change it: edit, pause or resume, end, skip the next date.
export function RuleSheet({
  rule,
  made,
  next,
  category,
  onClose,
  onEdit,
  onOpenEntry,
}: {
  rule: Rule;
  made: Entry[];
  next?: string;
  category?: Category;
  onClose: () => void;
  onEdit: () => void;
  onOpenEntry: (e: Entry) => void;
}) {
  const save = useSaveRule(rule.kind);
  const skip = useSaveEntry(rule.kind);
  const unskip = useDeleteEntry(rule.kind);
  const { showToast } = useToast();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const isEnded = ended(rule);
  const status = isEnded ? "ended" : rule.active ? "active" : "paused";
  const entries = [...made].sort((a, b) => b.date.localeCompare(a.date));
  const total = entries.filter(counted).reduce((s, e) => s + e.amount, 0);
  const busy = save.isPending || skip.isPending || unskip.isPending;

  const run = async (what: () => Promise<unknown>, done: string) => {
    try {
      await what();
      showToast(done, "success");
    } catch (e) {
      showToast(e instanceof GuestBlockedError ? e.message : `Couldn't do that: ${(e as Error).message}`, "error");
    }
  };

  const setActive = (active: boolean) =>
    run(() => save.mutateAsync({ id: rule.id, rule: ruleInput(rule, { is_active: active }) }), active ? "Rule resumed" : "Rule paused");

  // Ending keeps every entry the rule made; it makes no more after today
  // (or after yesterday, when today's entry isn't made yet).
  const end = () => {
    const last = made.some((e) => e.date === today()) ? today() : format(subDays(new Date(), 1), "yyyy-MM-dd");
    return run(async () => {
      await save.mutateAsync({ id: rule.id, rule: ruleInput(rule, { end_date: last < rule.startDate ? rule.startDate : last }) });
      setConfirmEnd(false);
    }, "Rule ended; its entries stay");
  };

  // Skipping makes the date's entry now, marked skipped, so the rule
  // moves on to the date after.
  const skipNext = (date: string) =>
    run(
      () =>
        skip.mutateAsync({
          input: {
            description: rule.description,
            amount: rule.amount,
            currency: rule.currency,
            date,
            categoryId: rule.categoryId,
            priority: rule.priority,
            notes: "",
            status: "skipped",
            ruleId: rule.id,
          },
        }),
      `Skipped ${short(date)}`,
    );

  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Rule: ${rule.description}`}
      header={
        <div className="flex flex-col gap-1.5">
          <p className={cn("flex items-center gap-1.5 text-sm font-medium", status === "active" ? "text-[#f4a084]" : "text-muted-foreground")}>
            <Repeat className="h-3.5 w-3.5" aria-hidden />
            Rule · {status}
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">{rule.description}</h2>
            <span className="font-mono text-xl">{money(rule.amount, rule.currency)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {cadencePhrase(rule.cadence, rule.startDate).replace(/^./, (c) => c.toUpperCase())}, since {long(rule.startDate)}
            {rule.endDate ? ` · ends ${long(rule.endDate)}` : ""}
            {rule.notes ? ` · “${rule.notes}”` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip category={category} />
            {rule.priority === "need" && <NeedChip />}
          </div>
        </div>
      }
    >
      {!isEnded &&
        (confirmEnd ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5">
            <p className="text-sm">
              End this rule? It makes no more {rule.kind === "expense" ? "expenses" : "incomes"}; the {made.length} it made stay.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmEnd(false)} className="min-h-11 rounded-xl border border-foreground/15 text-sm font-medium">
                Keep it
              </button>
              <button type="button" disabled={busy} onClick={end} className="min-h-11 rounded-xl bg-destructive text-sm font-semibold text-white disabled:opacity-50">
                End rule
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={onEdit} className="min-h-11 rounded-xl border border-foreground/15 text-sm font-medium hover:bg-foreground/5">
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setActive(!rule.active)}
              className="min-h-11 rounded-xl border border-foreground/15 text-sm font-medium hover:bg-foreground/5 disabled:opacity-50"
            >
              {rule.active ? "Pause" : "Resume"}
            </button>
            <button type="button" onClick={() => setConfirmEnd(true)} className="min-h-11 rounded-xl border border-destructive/40 text-sm font-medium text-[#f2777b] hover:bg-destructive/10">
              End…
            </button>
          </div>
        ))}

      <div className="flex flex-col">
        <div className="flex items-baseline justify-between pb-2">
          <h3 className="text-[15px] font-semibold text-foreground/85">Entries this rule made</h3>
          <span className="text-[13px] text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · <span className="font-mono text-foreground">{money(total, rule.currency)}</span>
          </span>
        </div>
        <ol className="flex flex-col border-t border-border">
          {next && (
            <li className="flex min-h-12 items-center gap-3 border-b border-border text-muted-foreground">
              <span className="w-16 font-mono text-[13px] text-accent">{short(next)}</span>
              <span className="flex-1 text-sm">Next · not made yet</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => skipNext(next)}
                className="min-h-[34px] rounded-full border border-foreground/15 px-3 text-xs font-medium text-foreground disabled:opacity-50"
              >
                Skip
              </button>
            </li>
          )}
          {!next && !isEnded && !rule.active && (
            <li className="flex min-h-12 items-center border-b border-border text-sm text-muted-foreground">Paused: nothing is made until you resume it.</li>
          )}
          {entries.map((e) => (
            <li key={e.id} className="flex min-h-12 items-center gap-3 border-b border-border last:border-b-0">
              <button type="button" onClick={() => onOpenEntry(e)} className="flex min-h-12 flex-1 items-center gap-3 text-left">
                <span className={cn("w-16 font-mono text-[13px]", e.date > today() && "text-accent")}>{short(e.date)}</span>
                <span className="flex-1 text-sm text-muted-foreground">
                  {e.status === "skipped" ? "Skipped" : e.date > today() ? "Upcoming" : "Posted"}
                </span>
                {e.status !== "skipped" && <span className="font-mono text-sm">{signed(e.kind, e.amount, e.currency)}</span>}
              </button>
              {e.status === "skipped" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => unskip.mutateAsync(e.id), `${short(e.date)} is back on`)}
                  className="min-h-[34px] rounded-full border border-foreground/15 px-3 text-xs font-medium disabled:opacity-50"
                >
                  Undo skip
                </button>
              )}
            </li>
          ))}
          {entries.length === 0 && <li className="py-4 text-sm text-muted-foreground">Nothing yet. Its first one comes on {next ? long(next) : long(rule.startDate)}.</li>}
        </ol>
      </div>
    </BottomSheet>
  );
}
