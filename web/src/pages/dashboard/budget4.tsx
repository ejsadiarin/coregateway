import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Repeat,
  Sparkles,
  ArrowRight,
  PiggyBank,
  CalendarClock,
} from "lucide-react";
import {
  useBudgetRemaining,
  useTrends,
  useFiftyThirtyTwenty,
  useRecurringExpenses,
  useSavingsRate,
  useCategoryBreakdown,
  useUpcomingBills,
} from "@/hooks/use-budget";
import { formatPeso } from "@/lib/format";

const MONTHLY_FACTOR: Record<string, number> = {
  daily: 30,
  weekly: 4.33,
  monthly: 1,
  yearly: 1 / 12,
};

function num(v: unknown): number {
  return Number(v) || 0;
}

// Research-backed advisor deck (Copilot free-to-spend + Monarch cash-flow /
// subscriptions / insights patterns). Read-only; mutations stay on
// /dashboard/budget. Delete freely; old page untouched.
export default function BudgetAdvisorDeck() {
  const { data: remaining } = useBudgetRemaining();
  const { data: trends } = useTrends();
  const { data: split } = useFiftyThirtyTwenty();
  const { data: recurring } = useRecurringExpenses();
  const { data: savings } = useSavingsRate();
  const { data: breakdown } = useCategoryBreakdown();
  const { data: bills } = useUpcomingBills();

  const free = num(remaining?.remaining);
  const series = [...(trends ?? [])].slice(-2);
  const [prev, cur] = [series[series.length - 2], series[series.length - 1]];
  const dIncome = num(cur?.total_incomes) - num(prev?.total_incomes);
  const dSpend = num(cur?.total_expenses) - num(prev?.total_expenses);
  const net = num(cur?.total_incomes) - num(cur?.total_expenses);

  const cats = [...(breakdown ?? [])].sort((a, b) => num(b.total_amount) - num(a.total_amount));
  const spentTotal = cats.reduce((s, c) => s + num(c.total_amount), 0);
  const top = cats[0];

  const subs = (recurring ?? []).filter((r) => r.is_active && r.recurring_type !== "one-time");
  const subsMonthly = subs.reduce((s, r) => s + num(r.amount) * (MONTHLY_FACTOR[r.recurring_type] ?? 1), 0);
  const subCurrency = subs[0]?.currency;

  const rate = num(savings?.savings_rate);
  const allBills = Array.isArray(bills) ? bills : [];
  const weekOut = new Date();
  weekOut.setDate(weekOut.getDate() + 7);
  const due7 = allBills.filter((b) => new Date(b.start_date) <= weekOut).length;

  const alloc = [
    { label: "Needs", actual: num(split?.needs_pct), target: 50, color: "var(--primary)" },
    { label: "Wants", actual: num(split?.wants_pct), target: 30, color: "var(--chart-3)" },
    { label: "Savings", actual: num(split?.savings_pct), target: 20, color: "var(--chart-2)" },
  ];

  const insights: { icon: typeof Wallet; text: string; tone: string }[] = [];
  if (top && spentTotal > 0) {
    insights.push({
      icon: Wallet,
      text: `${top.category_name} takes ${((num(top.total_amount) / spentTotal) * 100).toFixed(0)}% of spend — largest outflow.`,
      tone: "var(--primary)",
    });
  }
  insights.push({
    icon: PiggyBank,
    text:
      rate >= 20
        ? `Savings rate ${rate.toFixed(1)}% — on track, above the 20% rule.`
        : rate >= 0
          ? `Savings rate ${rate.toFixed(1)}% — below the 20% rule. Trim wants to close the gap.`
          : `Spending exceeds income by ${formatPeso(Math.abs(net))} — deficit month.`,
    tone: rate >= 20 ? "var(--chart-2)" : "var(--accent)",
  });
  if (subsMonthly > 0) {
    insights.push({
      icon: Repeat,
      text: `${subs.length} active subscriptions ≈ ${formatPeso(subsMonthly, subCurrency)} — review for forgotten charges.`,
      tone: "var(--chart-3)",
    });
  }
  if (due7 > 0) {
    insights.push({
      icon: CalendarClock,
      text: `${due7} bill${due7 === 1 ? "" : "s"} due in the next 7 days — cash check advised.`,
      tone: "var(--accent)",
    });
  }

  const deltas = [
    { label: "Income", delta: dIncome, month: cur?.month },
    { label: "Spending", delta: dSpend, month: cur?.month, invert: true },
  ];

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
      {/* Free-to-spend hero (Copilot pattern) */}
      <motion.section
        className="mb-6 rounded-xl border border-border bg-card/70 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Advisor deck · free to spend
            </p>
            <p className="font-mono tabular-nums text-4xl md:text-5xl font-bold text-primary mt-2">
              {formatPeso(free)}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground mt-1">
              {remaining?.period_start ?? "—"} → {remaining?.period_end ?? "—"} · net {formatPeso(net)}
            </p>
          </div>
          <Link
            to="/dashboard/budget"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary hover:opacity-80"
          >
            Full budget <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </motion.section>

      {/* Cash-flow deltas (Copilot cash-flow pattern) */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {deltas.map((d, i) => {
          const good = d.invert ? d.delta <= 0 : d.delta >= 0;
          const Icon = d.delta >= 0 ? ArrowUpRight : ArrowDownRight;
          return (
            <motion.div
              key={d.label}
              className="rounded-xl border border-border bg-card/60 px-4 py-3"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.06, 0.3) }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {d.label} · {d.month ?? "—"}
              </p>
              <p
                className="flex items-center gap-1 font-mono tabular-nums text-2xl font-bold mt-1"
                style={{ color: good ? "var(--chart-2)" : "var(--destructive)" }}
              >
                <Icon className="h-5 w-5" />
                {formatPeso(Math.abs(d.delta))}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">vs prior month</p>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
        <div className="xl:col-span-3 space-y-3">
          {/* 50/30/20 allocation */}
          <motion.section
            className="rounded-xl border border-border bg-card/60 px-4 py-3"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 }}
          >
            <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground mb-3">
              50 / 30 / 20 allocation
            </h2>
            <ul className="space-y-3">
              {alloc.map((a, i) => (
                <li key={a.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-foreground">{a.label}</span>
                    <span className="font-mono tabular-nums text-xs text-muted-foreground">
                      {a.actual.toFixed(1)}% / {a.target}%
                    </span>
                  </div>
                  <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ background: a.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, a.actual)}%` }}
                      transition={{ duration: 0.5, delay: 0.15 + i * 0.05 }}
                    />
                    <span
                      className="absolute inset-y-[-2px] w-0.5 bg-foreground/60"
                      style={{ left: `${a.target}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </motion.section>

          {/* Insights feed */}
          <motion.section
            className="rounded-xl border border-border bg-card/60"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
          >
            <div className="px-4 py-3 border-b border-border">
              <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Insights
              </h2>
            </div>
            <ul className="divide-y divide-border/50">
              {insights.map((s, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                  <s.icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: s.tone }} />
                  <p className="text-sm text-foreground">{s.text}</p>
                </li>
              ))}
              {insights.length === 0 && (
                <li className="px-4 py-6 font-mono text-xs text-muted-foreground text-center">
                  Not enough signal yet
                </li>
              )}
            </ul>
          </motion.section>
        </div>

        {/* Subscriptions strip (Monarch/Rocket pattern) */}
        <motion.section
          className="xl:col-span-2 rounded-xl border border-border bg-card/60 h-fit"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.2 }}
        >
          <div className="px-4 py-3 border-b border-border">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Subscriptions
            </p>
            <p className="font-mono tabular-nums text-2xl font-bold text-foreground mt-1">
              {formatPeso(subsMonthly, subCurrency)}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
              {subs.length} active · normalized to monthly
            </p>
          </div>
          <ul className="divide-y divide-border/50">
            {subs.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <Repeat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">{r.description}</span>
                <span className="font-mono tabular-nums text-sm text-foreground shrink-0">
                  {formatPeso(r.amount, r.currency)}
                </span>
              </li>
            ))}
            {subs.length === 0 && (
              <li className="px-4 py-6 font-mono text-xs text-muted-foreground text-center">
                No recurring charges tracked
              </li>
            )}
          </ul>
        </motion.section>
      </div>
    </div>
  );
}
