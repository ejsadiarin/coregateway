import { useMemo, type ReactNode } from "react";
import { Repeat } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError } from "@/hooks/use-budget";
import { entryInput, useSaveEntry } from "@/hooks/use-ledger";
import { useRuleReview } from "@/hooks/use-rule-review";
import { cadenceLabel, type Entry, type LedgerKind, type Rule } from "@/lib/ledger";
import { groupNewByRule } from "@/lib/rule-review";
import { skipStatus } from "@/lib/feed-rail";

// NewFromRules is the top of a ledger: the rule entries written since the
// owner last marked them reviewed on this device, grouped by rule (#13).
// Each row opens the entry as anywhere else, and skips or brings it back in
// one tap. Hidden while there is nothing new.
export function NewFromRules({
  kind,
  entries,
  rules,
  row,
}: {
  kind: LedgerKind;
  entries: Entry[];
  rules: Rule[];
  // row draws an entry as the rest of the ledger does.
  row: (e: Entry) => ReactNode;
}) {
  const { ids, markReviewed } = useRuleReview(kind);
  const groups = useMemo(() => groupNewByRule(ids, entries, rules), [ids, entries, rules]);
  const save = useSaveEntry(kind);
  const { showToast } = useToast();
  if (groups.length === 0) return null;
  const count = groups.reduce((n, g) => n + g.entries.length, 0);

  // Skipping keeps the entry, marked skipped; bringing it back lets its
  // date decide whether it is posted or still pending.
  const toggleSkip = async (e: Entry) => {
    try {
      await save.mutateAsync({ id: e.id, input: entryInput(e, { status: skipStatus(e.status) }) });
    } catch (err) {
      showToast(err instanceof GuestBlockedError ? err.message : `Couldn't do that: ${(err as Error).message}`, "error");
    }
  };

  return (
    <section aria-labelledby="new-from-rules-h" className="flex flex-col gap-2.5 px-4 pt-3.5 pb-1 lg:px-1">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="new-from-rules-h" className="text-[15px] font-semibold text-foreground/85">
          New from your rules <span className="font-normal text-muted-foreground">· {count}</span>
        </h2>
        <button type="button" onClick={markReviewed} className="min-h-[34px] rounded-full border border-foreground/15 px-3 text-xs font-medium hover:bg-foreground/5">
          Mark reviewed
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.ruleId} className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 px-1 text-[13px] text-muted-foreground">
            <Repeat className="h-3.5 w-3.5" aria-hidden />
            {g.rule ? `${cadenceLabel(g.rule.cadence)} · ${g.rule.description}` : "A rule since removed"}
          </p>
          <ul className="overflow-hidden rounded-2xl border border-accent/30 bg-popover">
            {g.entries.map((e) => (
              <li key={e.id} className="flex items-center border-b border-foreground/[0.06] last:border-b-0">
                <div className="min-w-0 flex-1">{row(e)}</div>
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => toggleSkip(e)}
                  className="mr-3 min-h-[34px] shrink-0 rounded-full border border-foreground/15 px-3 text-xs font-medium disabled:opacity-50"
                >
                  {e.status === "skipped" ? "Undo skip" : "Skip"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
