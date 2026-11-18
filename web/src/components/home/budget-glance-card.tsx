import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentTotalMoney, usePeriodBudget } from '@/hooks/use-budget';
import { todayISODate } from '@/lib/budget-period';
import { formatPeso } from '@/lib/format';

export function BudgetGlanceCard({ className }: { className?: string }) {
  const today = todayISODate();
  const money = useCurrentTotalMoney();
  const budget = usePeriodBudget('day', today);

  const isLoading = money.isLoading || budget.isLoading;
  const error = money.error || budget.error || !money.data || !budget.data;
  const safe = budget.data?.safe_to_spend_per_day ?? budget.data?.left ?? null;
  const overBudget = Number(budget.data?.left ?? 0) < 0;

  return (
    <Link to={`/dashboard/budget?period=day&date=${today}`} className="block">
      <Card
        data-testid="budget-glance-card"
        className={`transition-colors hover:border-primary/60 ${className ?? ''}`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Budget today</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 animate-pulse">
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-7 w-32 rounded bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-7 w-32 rounded bg-muted" />
              </div>
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">Budget unavailable · open Budget</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Money on hand</p>
                <p className={`text-2xl font-bold font-mono tabular-nums ${Number(money.data.total_money) < 0 ? 'text-destructive' : ''}`}>
                  {formatPeso(money.data.total_money)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
                  Safe to spend today
                </p>
                <p className={`text-2xl font-bold font-mono tabular-nums ${overBudget ? 'text-destructive' : ''}`}>
                  {safe === null ? '—' : formatPeso(safe)}
                </p>
                {overBudget && <p className="text-xs font-medium text-destructive">Over budget</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
