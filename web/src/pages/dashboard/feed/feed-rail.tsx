import { useMemo, useState } from "react";
import { addMonths, format, parseISO } from "date-fns";
import { BellRing, ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useBudgetRemaining } from "@/hooks/use-budget";
import { useEntries, useRules } from "@/hooks/use-ledger";
import { comingUp, monthDays, monthSummary } from "@/lib/feed-rail";
import { fetchKanbanReminders } from "@/lib/kanban";
import { money, nextDue, today, type Entry, type Rule } from "@/lib/ledger";
import { cn } from "@/lib/utils";

const NONE: never[] = [];

// shortNet is a day's net in a calendar cell: "+500", "−1.3k".
function shortNet(n: number): string {
  const sign = n < 0 ? "−" : "+";
  const a = Math.abs(n);
  return sign + (a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(Math.round(a)));
}

// nextOf pairs each active rule with its next date, as the ledger works it
// out: the first due date from today it hasn't made an entry for.
function nextOf(rules: Rule[], entries: Entry[]) {
  const made = new Map<string, Set<string>>();
  for (const e of entries) if (e.ruleId) made.set(e.ruleId, (made.get(e.ruleId) ?? new Set()).add(e.date));
  return rules.map((r) => ({ ...r, next: nextDue(r, made.get(r.id) ?? new Set()) }));
}

const card = "rounded-2xl border border-border bg-card/60 p-4";

// FeedRail sits beside the Feed on a wide screen (#22): a calendar that
// moves the chat to a day, what is coming up in the next seven days, and
// this month's budget. It supports the chat; the chat stays the page.
export function FeedRail({ noteDays, onPickDay }: { noteDays: Set<string>; onPickDay: (date: string) => void }) {
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const expenses = useEntries("expense").data ?? NONE;
  const incomes = useEntries("income").data ?? NONE;
  const expenseRules = useRules("expense").data ?? NONE;
  const incomeRules = useRules("income").data ?? NONE;
  const reminders = useQuery({ queryKey: ["kanban", "reminders"], queryFn: () => fetchKanbanReminders(), staleTime: 60000 }).data ?? NONE;
  const remaining = useBudgetRemaining().data;

  const cells = useMemo(() => monthDays(month, [...expenses, ...incomes], noteDays, today()), [month, expenses, incomes, noteDays]);
  const coming = useMemo(
    () => comingUp(reminders, [...nextOf(expenseRules, expenses), ...nextOf(incomeRules, incomes)], new Date()),
    [reminders, expenseRules, incomeRules, expenses, incomes],
  );
  const summary = remaining ? monthSummary(remaining) : undefined;
  const monthDate = parseISO(`${month}-01`);

  return (
    <aside aria-label="Feed side panel" className="hidden min-w-[300px] max-w-[420px] flex-1 flex-col gap-4 overflow-y-auto py-6 lg:flex">
      <section aria-labelledby="rail-cal-h" className={card}>
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(format(addMonths(monthDate, -1), "yyyy-MM"))}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-foreground/5"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <h2 id="rail-cal-h" className="text-[15px] font-semibold">
            {format(monthDate, "MMMM yyyy")}
          </h2>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(format(addMonths(monthDate, 1), "yyyy-MM"))}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-foreground/5"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="mb-1 grid grid-cols-7 text-center font-mono text-[11px] text-muted-foreground" aria-hidden>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((c, i) =>
            c ? (
              <button
                key={c.date}
                type="button"
                onClick={() => onPickDay(c.date)}
                aria-label={`${format(parseISO(c.date), "EEEE, MMMM d")}${c.net !== undefined ? `, net ${shortNet(c.net)}` : ""}`}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-px rounded-lg border border-transparent hover:bg-foreground/5",
                  c.today && "border-primary",
                  c.future && "text-muted-foreground/60",
                )}
              >
                <span className="text-[13px] leading-none">{c.day}</span>
                {c.net !== undefined ? (
                  <span className={cn("font-mono text-[9.5px] leading-none", c.net > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                    {shortNet(c.net)}
                  </span>
                ) : (
                  c.dot && <span className="h-1 w-1 rounded-full bg-muted-foreground" aria-hidden />
                )}
              </button>
            ) : (
              <span key={`blank-${i}`} aria-hidden />
            ),
          )}
        </div>
      </section>

      <section aria-labelledby="rail-up-h" className={cn(card, "flex flex-col gap-2")}>
        <h2 id="rail-up-h" className="text-[15px] font-semibold">
          Coming up <span className="font-normal text-muted-foreground">· next 7 days</span>
        </h2>
        {coming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in the next seven days.</p>
        ) : (
          <ul className="flex flex-col">
            {coming.map((c) => (
              <li key={c.key} className="flex min-h-12 items-center gap-3 border-b border-border last:border-b-0">
                <span className="w-14 shrink-0 font-mono text-xs text-[#e8795c]">{format(parseISO(c.date), "EEE d")}</span>
                {c.kind === "reminder" ? (
                  <BellRing className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Reminder" />
                ) : (
                  <Repeat className="h-3.5 w-3.5 shrink-0 text-[#f4a084]" aria-label="Rule entry" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {c.title}
                  {c.time && <span className="text-muted-foreground"> · {c.time}</span>}
                </span>
                {c.amount !== undefined && (
                  <span className={cn("shrink-0 font-mono text-[13px]", c.ruleKind === "income" && "text-emerald-400")}>
                    {c.ruleKind === "income" ? "+" : "−"}
                    {money(c.amount, c.currency)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary && (
        <section aria-labelledby="rail-month-h" className={cn(card, "flex flex-col gap-3")}>
          <h2 id="rail-month-h" className="text-[15px] font-semibold">
            This month
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Spent</span>
              <span className="font-mono text-[15px]">{money(summary.spent)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Received</span>
              <span className="font-mono text-[15px] text-emerald-400">{money(summary.received)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Left</span>
              <span className={cn("font-mono text-[15px]", summary.left < 0 ? "text-destructive" : "text-[#f4a084]")}>{money(summary.left)}</span>
            </div>
          </div>
          {summary.pct !== undefined && (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full bg-primary" style={{ width: `${summary.pct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{summary.pct}% of this month's income spent</p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
