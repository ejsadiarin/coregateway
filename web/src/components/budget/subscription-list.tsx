
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSubscriptions } from '@/hooks/use-budget';
import { RefreshCw, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { safeFormat } from '@/lib/utils';
import { formatPeso } from '@/lib/format';

interface SubscriptionListProps {
  className?: string;
}

export function SubscriptionList({ className }: SubscriptionListProps) {
  const { data, isLoading, error } = useSubscriptions();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Subscriptions</CardTitle>
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
          <CardTitle className="text-sm font-medium">Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load subscriptions</div>
        </CardContent>
      </Card>
    );
  }

  const subscriptions = data.subscriptions || [];

  const getRecurringBadge = (type: string) => {
    switch (type) {
      case 'monthly': return { label: 'Monthly', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
      case 'yearly': return { label: 'Yearly', color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' };
      case 'weekly': return { label: 'Weekly', color: 'bg-green-500/10 text-green-500 border-green-500/20' };
      default: return { label: type, color: 'bg-muted text-muted-foreground' };
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Subscriptions</CardTitle>
            <CardDescription className="text-xs">
              {data.count} active subscriptions
            </CardDescription>
          </div>
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {subscriptions.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No recurring subscriptions found
          </div>
        ) : (
          <div className="space-y-3">
            {subscriptions.map((sub) => {
              const badge = getRecurringBadge(sub.recurring_type);
              return (
                <div
                  key={sub.id}
                  className="flex items-center justify-between p-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{sub.description}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Next: {safeFormat(sub.next_due_date, (d) => format(d, 'MMM d, yyyy'))}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium font-mono tabular-nums">
                      {formatPeso(sub.amount, sub.currency)}
                    </div>
                    <Badge variant="outline" className={cn('text-xs mt-1', badge.color)}>
                      {badge.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
