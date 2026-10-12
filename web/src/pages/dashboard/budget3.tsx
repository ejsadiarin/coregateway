import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Terminal, ArrowRight } from "lucide-react";
import {
  PeriodPresetFilter,
  type PeriodPresetFilterValue,
} from "@/components/budget";
import {
  useSummaryStats,
  useSavingsRate,
  useSpendingVelocity,
  useCategoryBreakdown,
  useUpcomingBills,
} from "@/hooks/use-budget";
import { formatPeso, formatSigned } from "@/lib/format";

// Experimental signal-deck rebuild of the budget overview. Read-only —
// mutations stay on /dashboard/budget. Delete freely; old page untouched.
function last30Days(): PeriodPresetFilterValue {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(today), preset: "30d" };
}

export default function BudgetSignalDeck() {
  const [range, setRange] = useState<PeriodPresetFilterValue>(last30Days);

  const { data: stats, isLoading } = useSummaryStats(range.startDate, range.endDate);
  const { data: savings } = useSavingsRate(range.startDate, range.endDate);
  const { data: velocity } = useSpendingVelocity(range.startDate, range.endDate);
  const { data: breakdown } = useCategoryBreakdown(range.startDate, range.endDate);
  const { data: bills } = useUpcomingBills();

  const income = stats?.total_incomes ?? 0;
  const spent = stats?.total_expenses ?? 0;
  const net = income - spent;
  const rate = savings?.savings_rate ?? 0;
  const cats = [...(breakdown ?? [])].sort((a, b) => b.total_amount - a.total_amount).slice(0, 8);
  const maxCat = cats[0]?.total_amount ?? 1;
  const ops = Array.isArray(bills) ? bills.slice(0, 6) : [];

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
      {/* Floating terminal card */}
      <motion.section
        className="mb-6 rounded-xl border border-border bg-card/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
          <p className="font-mono text-xs text-muted-foreground truncate">
            <span className="text-primary">&gt;</span> query budget --period {range.preset}
          </p>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Live scan
          </span>
        </div>

        <div className="px-4 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Net position
              </p>
              {isLoading ? (
                <div className="h-10 w-48 bg-muted rounded animate-pulse mt-1" />
              ) : (
                <p className="font-mono tabular-nums text-4xl font-bold text-foreground mt-1">
                  {formatSigned(net, net >= 0 ? "income" : "expense")}
                </p>
              )}
            </div>
            <PeriodPresetFilter value={range} onChange={setRange} />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Inflows
              </p>
              <p className="font-mono tabular-nums text-xl text-[var(--chart-2)]">
                {formatPeso(income)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Outflows
              </p>
              <p className="font-mono tabular-nums text-xl text-primary">
                {formatPeso(spent)}
              </p>
            </div>
          </div>

          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "var(--primary)" }}
              initial={{ width: 0 }}
              animate={{ width: `${income > 0 ? Math.min(100, (spent / income) * 100) : 0}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-1.5">
            {stats?.expense_count ?? 0} expenses · {stats?.income_count ?? 0} incomes · spend-to-income ratio
          </p>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
        {/* Category signal bars */}
        <motion.section
          className="xl:col-span-3 rounded-xl border border-border bg-card/60 px-4 py-3"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
              Category signals
            </h2>
            <Link
              to="/dashboard/budget/expenses"
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary hover:opacity-80"
            >
              Ledger <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="space-y-2.5">
            {cats.map((c, i) => (
              <li key={c.category_id}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-xs text-foreground truncate">{c.category_name}</span>
                  <span className="font-mono tabular-nums text-xs text-muted-foreground shrink-0">
                    {formatPeso(c.total_amount)} · {c.expense_count}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "var(--primary)", opacity: 1 - i * 0.09 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(c.total_amount / maxCat) * 100}%` }}
                    transition={{ duration: 0.5, delay: 0.15 + Math.min(i * 0.05, 0.3) }}
                  />
                </div>
              </li>
            ))}
            {cats.length === 0 && (
              <li className="py-6 font-mono text-xs text-muted-foreground text-center">
                No category signal in this window
              </li>
            )}
          </ul>
        </motion.section>

        {/* Side tiles */}
        <div className="xl:col-span-2 space-y-3">
          <motion.section
            className="rounded-xl border border-border bg-card/60 px-4 py-3"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Savings rate
            </p>
            <p className="font-mono tabular-nums text-3xl font-bold text-accent mt-1">
              {rate.toFixed(1)}%
            </p>
            <p className="font-mono text-[10px] text-muted-foreground mt-1">
              velocity {formatPeso(velocity?.avg_monthly_spending ?? 0)}/mo · {velocity?.months_with_data ?? 0} mo sampled
            </p>
          </motion.section>

          <motion.section
            className="rounded-xl border border-border bg-card/60"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.2 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
                <Terminal className="h-3.5 w-3.5 text-primary" /> Beacons
              </h2>
              <Link
                to="/dashboard/budget"
                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary hover:opacity-80"
              >
                Manage <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <ul className="divide-y divide-border/50">
              {ops.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  <span className="text-sm text-foreground truncate flex-1">{b.description}</span>
                  <span className="font-mono tabular-nums text-sm text-foreground shrink-0">
                    {formatPeso(b.amount, b.currency)}
                  </span>
                </li>
              ))}
              {ops.length === 0 && (
                <li className="px-4 py-6 font-mono text-xs text-muted-foreground text-center">
                  No beacons in range
                </li>
              )}
            </ul>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
