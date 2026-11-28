import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Odometer } from '@/components/ui/odometer';
import { useCurrentTotalMoney } from '@/hooks/use-budget';
import { formatPeso } from '@/lib/format';

interface MoneyOnHandCardProps {
  className?: string;
}

export function MoneyOnHandCard({ className }: MoneyOnHandCardProps) {
  const { data, isLoading, error } = useCurrentTotalMoney();

  return (
    <Card className={className} data-testid="money-on-hand-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Money on hand</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 animate-pulse">
                <div className="h-3 w-20 bg-muted rounded" />
                <div className="h-8 w-32 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : error || !data ? (
          <p className="text-sm text-muted-foreground">Failed to load money on hand</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-3 md:divide-x md:divide-border">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Today</p>
              <p
                className={`mt-1 text-3xl font-bold font-mono tabular-nums ${
                  Number(data.total_money) < 0 ? 'text-destructive' : ''
                }`}
              >
                <Odometer value={Number(data.total_money)} format={formatPeso} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Income less expenses dated today or earlier</p>
            </div>
            <div className="md:pl-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Committed</p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums">
                <Odometer value={Number(data.committed)} format={formatPeso} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Future-dated expenses already planned</p>
            </div>
            <div className="md:pl-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Runway</p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums">
                {data.runway_days === null ? '—' : `${data.runway_days} days`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {Number(data.average_daily_spend) > 0
                  ? `At ${formatPeso(data.average_daily_spend)}/day over 30 days`
                  : 'No spending in the last 30 days'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
