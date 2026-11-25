import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { todayISODate } from '@/lib/budget-period';
import { formatPeso } from '@/lib/format';
import type { PeriodBudgetResponse } from '@/types/api';

interface PeriodBudgetCardProps {
  data?: PeriodBudgetResponse;
  isLoading: boolean;
  isPast: boolean;
  className?: string;
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: 'negative' | 'positive';
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold font-mono tabular-nums ${
          tone === 'negative' ? 'text-destructive' : tone === 'positive' ? 'text-[var(--chart-2)]' : ''
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function PeriodBudgetCard({ data, isLoading, isPast, className }: PeriodBudgetCardProps) {
  if (isLoading) {
    return (
      <Card className={className} data-testid="period-budget-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Period budget</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2 animate-pulse">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-6 w-24 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className={className} data-testid="period-budget-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Period budget</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Failed to load this period's budget</p>
        </CardContent>
      </Card>
    );
  }

  const projected = Number(data.projected_income);
  const left = Number(data.left);
  const future = data.start_date > todayISODate();
  const unit = data.period === "day" ? "day" : data.period === "week" ? "week" : "month";
  const spentNote = isPast ? 'for the period' : future ? 'not started' : 'through today';
  const pace =
    data.period === 'day'
      ? isPast
        ? `${formatPeso(data.spent)} that day · ${formatPeso(data.previous_spent_total)} the day before`
        : `${formatPeso(data.spent)} today · ${formatPeso(data.previous_spent_to_point)} by this time yesterday`
      : isPast
        ? `${formatPeso(data.spent)} that ${unit} · ${formatPeso(data.previous_spent_total)} the ${unit} before`
        : `${formatPeso(data.spent)} this ${unit} · ${formatPeso(data.previous_spent_to_point)} by the same point last ${unit}`;

  return (
    <Card className={className} data-testid="period-budget-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Period budget</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Funded"
            value={<CountUp value={Number(data.funded)} format={formatPeso} />}
            note={projected > 0 ? `includes ${formatPeso(projected)} projected` : 'income this period'}
          />
          <Metric label="Spent" value={<CountUp value={Number(data.spent)} format={formatPeso} />} note={spentNote} />
          <Metric
            label="Bills still due"
            value={<CountUp value={Number(data.bills_still_due)} format={formatPeso} />}
            note={isPast ? 'none' : 'after today'}
          />
          <Metric
            label="Left"
            value={<CountUp value={left} format={formatPeso} />}
            note={left < 0 ? 'over budget' : 'funded − spent − bills'}
            tone={left < 0 ? 'negative' : 'positive'}
          />
          <Metric
            label="Safe to spend"
            value={data.safe_to_spend_per_day === null ? 'n/a' : `${formatPeso(data.safe_to_spend_per_day)}/day`}
            note={data.safe_to_spend_per_day === null ? 'past period' : 'for the days remaining'}
          />
        </div>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Pace</p>
          <p className="text-sm text-muted-foreground font-mono tabular-nums">{pace}</p>
        </div>
      </CardContent>
    </Card>
  );
}
