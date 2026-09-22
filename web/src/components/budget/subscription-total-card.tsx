
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSubscriptions } from '@/hooks/use-budget';
import { formatPeso, formatCount } from '@/lib/format';
import { CreditCard } from 'lucide-react';

interface SubscriptionTotalCardProps {
  className?: string;
}

export function SubscriptionTotalCard({ className }: SubscriptionTotalCardProps) {
  const { data, isLoading, error } = useSubscriptions();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Subscription Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-16 flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Subscription Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load data</div>
        </CardContent>
      </Card>
    );
  }

  const yearlyEstimate = data.total_monthly * 12;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Subscription Cost</CardTitle>
            <CardDescription className="text-xs">{data.count} active</CardDescription>
          </div>
          <div className="p-3 rounded-full bg-primary/10">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold font-mono tabular-nums">{formatPeso(data.total_monthly)}</div>
        <div className="text-xs text-muted-foreground mt-1">per month</div>

        <div className="mt-4 pt-3 border-t border-border space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Yearly estimate</span>
            <span className="font-medium font-mono tabular-nums">{formatPeso(yearlyEstimate)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Active subscriptions</span>
            <span className="font-medium font-mono tabular-nums">{formatCount(data.count)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
