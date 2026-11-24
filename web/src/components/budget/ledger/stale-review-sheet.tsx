import { useState } from "react";
import { format, parseISO } from "date-fns";
import { BottomSheet } from "./bottom-sheet";
import { useToast } from "@/components/ui/toast";
import { saveFailureMessage } from "@/hooks/use-budget";
import { entryInput, useSaveEntry } from "@/hooks/use-ledger";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { editToPickCategory } from "@/lib/category-error";
import { signed, type Entry, type Rule } from "@/lib/ledger";
import type { StaleReport } from "@/lib/rule-review";

const long = (d: string) => format(parseISO(d.slice(0, 10)), "MMM d, yyyy");

// StaleReviewSheet reports what a rule's schedule change did to its
// entries (corefinance ADR-0001): the untouched ones the new schedule no
// longer makes were skipped, and the ones the owner had edited were kept
// for them to skip or keep. It shows once, from the save's answer.
export function StaleReviewSheet({
  rule,
  report,
  entries,
  onClose,
}: {
  rule: Rule;
  report: StaleReport;
  // entries are the ledger's live entries by id, for each one's details.
  entries: Map<string, Entry>;
  onClose: () => void;
}) {
  const save = useSaveEntry(rule.kind);
  const zone = useUserTimezone().data?.timezone;
  const { showToast } = useToast();
  const [open, setOpen] = useState(report.review.map((e) => e.id));
  const noun = rule.kind === "expense" ? "expense" : "income";

  const settle = (id: string) => setOpen((ids) => ids.filter((x) => x !== id));

  const skip = async (id: string) => {
    const e = entries.get(id);
    if (!e) {
      // Deleted since: nothing left to skip.
      showToast("That entry is no longer in the ledger", "error");
      return settle(id);
    }
    try {
      await save.mutateAsync({ id, input: entryInput(e, { status: "skipped" }, zone) });
      settle(id);
    } catch (err) {
      showToast(saveFailureMessage(err, "Couldn't skip it: ", editToPickCategory("entry")), "error");
    }
  };

  const review = report.review.filter((s) => open.includes(s.id));

  return (
    <BottomSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Rule changed: ${rule.description}`}
      header={
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">The new schedule left some entries behind</h2>
          <p className="text-sm text-muted-foreground">{rule.description}</p>
        </div>
      }
      footer={
        <button type="button" onClick={onClose} className="min-h-[52px] w-full rounded-2xl border border-foreground/15 text-base font-semibold">
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {report.skipped > 0 && (
          <p className="text-sm">
            {report.skipped} {report.skipped === 1 ? `${noun} the new schedule no longer makes was` : `${noun}s the new schedule no longer makes were`}{" "}
            skipped.
          </p>
        )}
        {report.review.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {report.review.length === 1
                ? `1 ${noun} you edited no longer fits the new schedule.`
                : `${report.review.length} ${noun}s you edited no longer fit the new schedule.`}{" "}
              Skip it to take it out of the budget, or keep it as it is.
            </p>
            {review.length === 0 && <p className="text-sm text-muted-foreground">All sorted.</p>}
            <ol className="flex flex-col border-t border-border">
              {review.map((s) => {
                const e = entries.get(s.id);
                return (
                  <li key={s.id} className="flex min-h-14 items-center gap-3 border-b border-border">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{e?.description || rule.description}</span>
                      <span className="font-mono text-xs text-muted-foreground">{long(s.date)}</span>
                    </span>
                    {e && <span className="font-mono text-sm">{signed(e.kind, e.amount, e.currency)}</span>}
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => skip(s.id)}
                      className="min-h-[34px] rounded-full border border-foreground/15 px-3 text-xs font-medium disabled:opacity-50"
                    >
                      Skip
                    </button>
                    <button type="button" onClick={() => settle(s.id)} className="min-h-[34px] rounded-full px-3 text-xs font-medium text-muted-foreground">
                      Keep
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
