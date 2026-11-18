import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCategoryBreakdown, useFiftyThirtyTwenty } from '@/hooks/use-budget';
import { budgetPeriodBounds, previousBudgetPeriod } from '@/lib/budget-period';
import { formatPeso, formatRate } from '@/lib/format';
import { compareCategories, needsWantsSplit } from '@/lib/where-it-went';
import type { BudgetPeriod } from '@/types/api';

interface WhereItWentCardProps {
  period: BudgetPeriod;
  date: string;
  className?: string;
}

export function WhereItWentCard({ period, date, className }: WhereItWentCardProps) {
  const current = budgetPeriodBounds(period, date);
  const previous = previousBudgetPeriod(period, date);
  const { data: currentRows, isLoading, error } = useCategoryBreakdown(
    current.start_date,
    current.end_date,
  );
  const { data: previousRows } = useCategoryBreakdown(previous.start_date, previous.end_date);
  const { data: split } = useFiftyThirtyTwenty(current.start_date, current.end_date);

  const changes = compareCategories(currentRows ?? [], previousRows ?? []);
  const priorities = needsWantsSplit(
    Number(split?.needs) || 0,
    Number(split?.wants) || 0,
    Number(split?.savings) || 0,
  );

  return (
    <Card className={className} data-testid="where-it-went-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Where it went</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">Failed to load spending by category</p>
        ) : changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spending in this period.</p>
        ) : (
          <>
            <div className="divide-y divide-border/60">
              {changes.map((row) => (
                <div key={row.category_id} className="grid grid-cols-[1fr_auto] items-center gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: row.category_color || 'var(--chart-1)' }}
                      />
                      <span className="truncate text-sm font-medium">{row.category_name}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatRate(row.share * 100, 0)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-muted">
                      <div
                        className="h-1 rounded-full"
                        style={{
                          width: `${row.share * 100}%`,
                          background: row.category_color || 'var(--chart-1)',
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold font-mono tabular-nums">{formatPeso(row.amount)}</p>
                    <p
                      className={`text-xs font-mono tabular-nums ${
                        row.isNew
                          ? 'text-[var(--chart-2)]'
                          : row.direction === 'up'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {row.isNew
                        ? 'new'
                        : row.direction === 'flat'
                          ? 'no change'
                          : `${row.direction === 'up' ? '+' : '−'}${formatPeso(Math.abs(row.change))}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border/60 pt-3">
              <p className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Needs</span>
                <span className="text-sm font-semibold font-mono tabular-nums">{formatPeso(priorities.needs)}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {formatRate(priorities.needsShare * 100, 0)}
                </span>
              </p>
              <p className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Wants</span>
                <span className="text-sm font-semibold font-mono tabular-nums">{formatPeso(priorities.wants)}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {formatRate(priorities.wantsShare * 100, 0)}
                </span>
              </p>
              {priorities.savings > 0 ? (
                <p className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Savings</span>
                  <span className="text-sm font-semibold font-mono tabular-nums">{formatPeso(priorities.savings)}</span>
                </p>
              ) : (
                <p className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Total spent</span>
                  <span className="text-sm font-semibold font-mono tabular-nums">{formatPeso(priorities.total)}</span>
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
