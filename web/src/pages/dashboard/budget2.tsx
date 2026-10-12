import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Crosshair, ArrowRight } from "lucide-react";
import {
  PeriodPresetFilter,
  type PeriodPresetFilterValue,
} from "@/components/budget";
import {
  useSummaryStats,
  useExpenses,
  useBudgetRemaining,
  useSpendingVelocity,
  useUpcomingBills,
} from "@/hooks/use-budget";
import { formatPeso } from "@/lib/format";

function last30Days(): PeriodPresetFilterValue {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(today), preset: "30d" };
}

const PRIORITY_DOT: Record<string, string> = {
  need: "var(--destructive)",
  want: "#f59e0b",
  savings: "var(--chart-2)",
};

// Experimental techy rebuild of the budget overview. Read-only command deck —
// all mutations stay on /dashboard/budget. Delete freely; old page untouched.
export default function BudgetTacticalDeck() {
  const [range, setRange] = useState<PeriodPresetFilterValue>(last30Days);

  const { data: stats, isLoading: statsLoading } = useSummaryStats(
    range.startDate,
    range.endDate,
  );
  const { data: remaining } = useBudgetRemaining();
  const { data: velocity } = useSpendingVelocity(range.startDate, range.endDate);
  const { data: bills } = useUpcomingBills();
  const { data: expenses } = useExpenses(
    range.startDate && range.endDate
      ? { start_date: range.startDate, end_date: range.endDate }
      : undefined,
    1,
    8,
  );

  const spent = Number(stats?.total_expenses) || 0;
  const income = Number(stats?.total_incomes) || 0;
  const left = Number(remaining?.remaining) || 0;
  const burn = Number(velocity?.avg_monthly_spending) || 0;
  const usedPct = spent + left > 0 ? Math.min(100, (spent / (spent + left)) * 100) : 0;
  const feed = expenses?.data ?? [];
  const ops = Array.isArray(bills) ? bills.slice(0, 5) : [];

  const tiles = [
    { label: "Spent", value: formatPeso(spent), color: "var(--primary)", sub: `${stats?.expense_count ?? 0} ops logged` },
    { label: "Income", value: formatPeso(income), color: "var(--chart-2)", sub: `${stats?.income_count ?? 0} inflows` },
    { label: "Remaining", value: formatPeso(left), color: "var(--accent)", sub: `period ${remaining?.period_start ?? "—"} → ${remaining?.period_end ?? "—"}` },
    { label: "Burn / mo", value: formatPeso(burn), color: "var(--chart-3)", sub: `${velocity?.months_with_data ?? 0} mo sampled` },
  ];

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
      {/* Clipped command header */}
      <motion.div
        className="mb-6 border border-border bg-card/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
        style={{ clipPath: "polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%)" }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Crosshair className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Finance // Tactical deck
              </p>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                Budget Command
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              Live
            </span>
            <PeriodPresetFilter value={range} onChange={setRange} />
          </div>
        </div>
      </motion.div>

      {/* KPI readouts */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {statsLoading
          ? [...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-sm border border-border bg-card/50 animate-pulse" />
            ))
          : tiles.map((t, i) => (
              <motion.div
                key={t.label}
                className="rounded-sm border border-border bg-card/60 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.06, 0.3) }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {t.label}
                </p>
                <p className="font-mono tabular-nums text-2xl font-bold mt-1 truncate" style={{ color: t.color }}>
                  {t.value}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground mt-1 truncate">{t.sub}</p>
              </motion.div>
            ))}
      </div>

      {/* Capacity bar */}
      <motion.div
        className="mb-6 rounded-sm border border-border bg-card/60 px-4 py-3"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
      >
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-2">
          <span>Capacity burn</span>
          <span className="tabular-nums text-foreground">{usedPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-muted rounded-sm overflow-hidden">
          <motion.div
            className="h-full rounded-sm"
            style={{
              background: "var(--primary)",
              boxShadow: "0 0 8px color-mix(in srgb, var(--primary) 45%, transparent)",
            }}
            initial={{ width: 0 }}
            animate={{ width: `${usedPct}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
        {/* Expense log feed */}
        <motion.section
          className="xl:col-span-3 rounded-sm border border-border bg-card/60"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15 }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
              Expense log
            </h2>
            <Link
              to="/dashboard/budget/expenses"
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary hover:opacity-80"
            >
              Full ledger <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="divide-y divide-border/50">
            {feed.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: PRIORITY_DOT[e.priority] ?? "var(--chart-3)" }}
                />
                <span className="text-sm text-foreground truncate flex-1">{e.description}</span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {e.expense_date.slice(0, 10)}
                </span>
                <span className="font-mono tabular-nums text-sm text-foreground shrink-0">
                  {formatPeso(e.amount, e.currency)}
                </span>
              </li>
            ))}
            {feed.length === 0 && (
              <li className="px-4 py-6 font-mono text-xs text-muted-foreground text-center">
                No ops in this window —{" "}
                <Link to="/dashboard/budget" className="text-primary">log one on the main deck</Link>
              </li>
            )}
          </ul>
        </motion.section>

        {/* Upcoming ops rail */}
        <motion.section
          className="xl:col-span-2 rounded-sm border border-border bg-card/60"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.2 }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
              Upcoming ops
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
              <li key={b.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground truncate">{b.description}</span>
                  <span className="font-mono tabular-nums text-sm text-accent shrink-0">
                    {formatPeso(b.amount, b.currency)}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                  {b.recurring_type} · {b.start_date.slice(0, 10)}
                </p>
              </li>
            ))}
            {ops.length === 0 && (
              <li className="px-4 py-6 font-mono text-xs text-muted-foreground text-center">
                No inbound ops
              </li>
            )}
          </ul>
        </motion.section>
      </div>
    </div>
  );
}
