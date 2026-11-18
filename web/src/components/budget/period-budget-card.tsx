import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  value: string;
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
      <Card className={className}>
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
      <Card className={className}>
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

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Period budget</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Funded"
            value={formatPeso(data.funded)}
            note={projected > 0 ? `includes ${formatPeso(projected)} projected` : 'income this period'}
          />
          <Metric label="Spent" value={formatPeso(data.spent)} note="through today" />
          <Metric label="Bills still due" value={formatPeso(data.bills_still_due)} note="after today" />
          <Metric
            label="Left"
            value={formatPeso(left)}
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
          <p className="text-sm text-muted-foreground font-mono tabular-nums">
            {isPast
              ? `${formatPeso(data.spent)} total · ${formatPeso(data.previous_spent_total)} previous period`
              : `${formatPeso(data.spent)} so far · ${formatPeso(data.previous_spent_to_point)} by the same point`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
