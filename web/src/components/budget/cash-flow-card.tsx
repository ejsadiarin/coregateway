import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCashFlow } from '@/hooks/use-budget';
import { budgetPeriodTitle } from '@/lib/budget-period';
import { CASH_FLOW_COUNTS, CASH_FLOW_WINDOW_LABELS, cashFlowMax, isCurrentBucket } from '@/lib/cash-flow';
import { formatPeso } from '@/lib/format';
import type { BudgetPeriod } from '@/types/api';

interface CashFlowCardProps {
  period: BudgetPeriod;
  className?: string;
}

function bucketTick(period: BudgetPeriod, start: string): string {
  const date = parseISO(start);
  return period === 'day' ? format(date, 'd') : period === 'week' ? format(date, 'd MMM') : format(date, 'MMM');
}

export function CashFlowCard({ period, className }: CashFlowCardProps) {
  const count = CASH_FLOW_COUNTS[period];
  const { data, isLoading, error } = useCashFlow(period, count);
  const [selected, setSelected] = useState<number | null>(null);

  const buckets = data?.buckets ?? [];
  const activeIndex = selected !== null && selected < buckets.length ? selected : buckets.length - 1;
  const active = buckets[activeIndex];
  const max = cashFlowMax(buckets);
  const hasData = buckets.some((bucket) => Number(bucket.income) !== 0 || Number(bucket.spent) !== 0);

  return (
    <Card className={className} data-testid="cash-flow-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Cash flow</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{CASH_FLOW_WINDOW_LABELS[period]}</p>
          </div>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" />
              Income
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--destructive)]" />
              Spent
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded bg-muted" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">Failed to load cash flow</p>
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground">No cash flow in this window yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto pb-1">
              <div
                className="flex h-36 min-w-full items-end gap-1"
                role="group"
                aria-label={`Income and spending for ${CASH_FLOW_WINDOW_LABELS[period].toLowerCase()}`}
              >
              {buckets.map((bucket, index) => {
                const current = isCurrentBucket(index, buckets.length);
                const range = budgetPeriodTitle(period, bucket.start_date, bucket.end_date);
                return (
                  <button
                    key={bucket.start_date}
                    type="button"
                    aria-pressed={index === activeIndex}
                    aria-current={current ? 'true' : undefined}
                    aria-label={`${range}: income ${formatPeso(bucket.income)}, spent ${formatPeso(
                      bucket.spent,
                    )}, net ${formatPeso(bucket.net)}`}
                    className={`flex min-w-11 flex-1 flex-col items-center gap-1 rounded-sm pb-1 outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring ${
                      index === activeIndex ? 'bg-accent/20' : ''
                    }`}
                    onClick={() => setSelected(index)}
                    onMouseEnter={() => setSelected(index)}
                    onFocus={() => setSelected(index)}
                  >
                    <span className="flex h-24 w-full items-end justify-center gap-[2px]">
                      <span
                        className="w-1/3 max-w-3 rounded-t-sm bg-[var(--chart-2)]"
                        style={{ height: `${(Number(bucket.income) / max) * 100}%` }}
                      />
                      <span
                        className="w-1/3 max-w-3 rounded-t-sm bg-[var(--destructive)]"
                        style={{ height: `${(Number(bucket.spent) / max) * 100}%` }}
                      />
                    </span>
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        current ? 'font-semibold text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      {bucketTick(period, bucket.start_date)}
                    </span>
                    <span className="h-3 text-[8px] uppercase tracking-[0.18em] font-mono text-primary">
                      {current ? 'now' : ''}
                    </span>
                  </button>
                );
                })}
              </div>
            </div>

            {active && (
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3">
                <p className="text-xs text-muted-foreground">
                  {budgetPeriodTitle(period, active.start_date, active.end_date)}
                </p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatPeso(active.income)} income · {formatPeso(active.spent)} spent ·{' '}
                  <span className={Number(active.net) < 0 ? 'text-destructive' : 'text-[var(--chart-2)]'}>
                    {formatPeso(active.net)} net
                  </span>
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
