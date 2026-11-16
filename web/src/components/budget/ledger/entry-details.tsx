import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronRight, Repeat } from "lucide-react";
import { BottomSheet } from "./bottom-sheet";
import { CategoryBadge, CategoryChip, NeedChip, StatusChip, TagChip } from "./chips";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError } from "@/hooks/use-budget";
import { useDeleteEntry, useToggleSkip } from "@/hooks/use-ledger";
import { cadenceLabel, signed, today, type Entry, type Rule } from "@/lib/ledger";
import { conversionLabel } from "@/lib/conversion";
import type { Category, Tag } from "@/types/api";

// EntryDetails is what a tap on a row opens: the whole entry, and Edit and
// Delete. A rule entry can also be skipped for its date alone.
export function EntryDetails({
  entry,
  category,
  tags,
  rule,
  onClose,
  onEdit,
  onOpenRule,
}: {
  entry: Entry;
  category?: Category;
  tags: Tag[];
  rule?: Rule;
  onClose: () => void;
  onEdit: () => void;
  onOpenRule: (r: Rule) => void;
}) {
  const remove = useDeleteEntry(entry.kind);
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const noun = entry.kind === "expense" ? "expense" : "income";

  const skip = useToggleSkip();
  const skipped = entry.status === "skipped";
  const conversion = conversionLabel(entry);
  const toggleSkip = async () => {
    if (await skip.toggle(entry)) showToast(skipped ? "It counts again" : "Skipped this date", "success");
  };

  const del = async () => {
    try {
      await remove.mutateAsync(entry.id);
      showToast(`Deleted “${entry.description}”`, "success");
      onClose();
    } catch (e) {
      showToast(e instanceof GuestBlockedError ? e.message : `Couldn't delete: ${(e as Error).message}`, "error");
    }
  };

  return (
    <BottomSheet open onOpenChange={(o) => !o && onClose()} title={entry.description}>
      <div className="flex items-center gap-3">
        <CategoryBadge category={category} className="h-12 w-12 rounded-2xl" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-xl font-semibold">{entry.description}</h2>
          <p className="text-sm text-muted-foreground">{format(parseISO(entry.date), "EEEE, MMM d, yyyy")}</p>
        </div>
        <span className="font-mono text-xl">{signed(entry.kind, entry.amount, entry.currency)}</span>
      </div>

      {conversion && (
        <p
          data-testid="conversion"
          className="rounded-2xl bg-background px-3.5 py-2.5 font-mono text-sm tabular-nums text-muted-foreground"
        >
          {conversion}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <CategoryChip category={category} />
        {entry.priority === "need" && <NeedChip />}
        {entry.priority === "savings" && <span className="inline-flex h-[22px] items-center rounded-full bg-blue-400/15 px-2.5 text-xs font-medium text-blue-300">Savings</span>}
        {tags.map((t) => (
          <TagChip key={t.id} tag={t} />
        ))}
        {entry.status === "skipped" && <StatusChip status="skipped" />}
        {entry.status === "pending" && entry.date > today() && <StatusChip status="pending" />}
      </div>

      {entry.notes && <p className="rounded-2xl bg-background px-3.5 py-3 text-[15px] leading-relaxed text-foreground/90">{entry.notes}</p>}

      {rule && (
        <button
          type="button"
          onClick={() => onOpenRule(rule)}
          className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.07] px-3.5 text-left"
        >
          <Repeat className="h-4 w-4 text-[#f4a084]" aria-hidden />
          <span className="flex-1 text-[15px]">
            Made by the rule <b className="font-semibold">{rule.description}</b>
            <span className="text-muted-foreground"> · {cadenceLabel(rule.cadence)}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
      )}

      {entry.ruleId && !confirm && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-primary/25 bg-primary/[0.06] p-3.5">
          <p className="text-sm leading-relaxed">
            {skipped
              ? "Skipped: it stays in your history, crossed out, and doesn't count."
              : "Not paying this one? Skip just this date. It stays in your history, crossed out, and stops counting. The rule carries on."}
          </p>
          <button
            type="button"
            disabled={skip.pending}
            onClick={toggleSkip}
            className="min-h-11 rounded-xl border border-primary/40 bg-primary/10 text-[15px] font-semibold text-[#f4a084] disabled:opacity-50"
          >
            {skipped ? "Undo skip" : "Skip this date"}
          </button>
        </div>
      )}

      {confirm ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5">
          <p className="text-sm">
            Delete this {noun}? It leaves the budget and its note leaves the Feed.
            {entry.ruleId && " The rule keeps going; skip a date from the rule instead to keep a record of it."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirm(false)} className="min-h-11 rounded-xl border border-foreground/15 text-sm font-medium">
              Keep it
            </button>
            <button type="button" disabled={remove.isPending} onClick={del} className="min-h-11 rounded-xl bg-destructive text-sm font-semibold text-white disabled:opacity-50">
              {remove.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onEdit} className="min-h-12 rounded-2xl bg-foreground text-[15px] font-semibold text-background">
            Edit
          </button>
          <button type="button" onClick={() => setConfirm(true)} className="min-h-12 rounded-2xl border border-destructive/40 text-[15px] font-medium text-[#f2777b]">
            Delete
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
