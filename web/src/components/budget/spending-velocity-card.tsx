
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSpendingVelocity } from '@/hooks/use-budget';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPeso, formatCount } from '@/lib/format';

interface SpendingVelocityCardProps {
  startDate?: string;
  endDate?: string;
  className?: string;
}

export function SpendingVelocityCard({ startDate, endDate, className }: SpendingVelocityCardProps) {
  const hasPeriod = !!startDate && !!endDate;
  const { data, isLoading, error } = useSpendingVelocity(startDate, endDate);

  if (!hasPeriod) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Avg Monthly Spending</CardTitle>
          <CardDescription className="text-xs">
            Select a period to see velocity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Per month average</p>
              <div className="text-3xl font-bold font-mono tabular-nums text-muted-foreground">
                —
              </div>
            </div>
            <div className={cn('p-3 rounded-full bg-muted')}>
              <Gauge className={cn('h-5 w-5 text-muted-foreground')} />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spending Velocity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            <div className="h-8 w-40 bg-muted rounded" />
            <div className="h-3 w-28 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spending Velocity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load spending velocity</div>
        </CardContent>
      </Card>
    );
  }

  const avgMonthly = Number(data.avg_monthly_spending) || 0;
  const monthsData = data.months_with_data ?? 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Avg Monthly Spending</CardTitle>
        <CardDescription className="text-xs">
          Based on {formatCount(monthsData)} month{monthsData !== 1 ? 's' : ''} of data
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Per month average</p>
            <div className="text-3xl font-bold font-mono tabular-nums text-foreground">
              {formatPeso(avgMonthly)}
            </div>
          </div>
          <div className={cn('p-3 rounded-full bg-muted')}>
            <Gauge className={cn('h-5 w-5 text-muted-foreground')} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
