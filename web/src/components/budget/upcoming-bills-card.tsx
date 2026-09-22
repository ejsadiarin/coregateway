
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUpcomingBills } from '@/hooks/use-budget';
import { Calendar, Clock, DollarSign } from 'lucide-react';
import { cn, safeFormat } from '@/lib/utils';
import { formatPeso } from '@/lib/format';
import { format, parseISO, isWithinInterval, addDays, startOfDay } from 'date-fns';

interface UpcomingBillsCardProps {
  days?: 7 | 30;
  className?: string;
}

export function UpcomingBillsCard({ days = 30, className }: UpcomingBillsCardProps) {
  const { data, isLoading, error } = useUpcomingBills();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Upcoming Bills</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-9 w-9 bg-muted rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-2/3 bg-muted rounded" />
                  <div className="h-3 w-1/3 bg-muted rounded" />
                </div>
                <div className="h-4 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Upcoming Bills</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load upcoming bills</div>
        </CardContent>
      </Card>
    );
  }

  const bills = Array.isArray(data) ? data : [];
  const today = startOfDay(new Date());
  const windowEnd = addDays(today, days);

  const inWindow = bills.filter((b) => {
    if (!b.start_date) return false;
    try {
      return isWithinInterval(parseISO(b.start_date), { start: today, end: windowEnd });
    } catch {
      return false;
    }
  });
  const totalAmount = inWindow.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

  const getDueStatus = (dueDate: string) => {
    const date = parseISO(dueDate);
    if (isWithinInterval(date, { start: today, end: windowEnd })) {
      return { label: 'Soon', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' };
    }
    return { label: 'Upcoming', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
  };

  const displayedBills = inWindow.slice(0, 5);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming Bills</CardTitle>
            <CardDescription className="text-xs">
              Next {days} days
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Total due</p>
            <div className="text-2xl font-bold font-mono tabular-nums">{formatPeso(totalAmount)}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {inWindow.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No bills due in the next {days} days
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {displayedBills.map((bill) => {
              const status = bill.start_date ? getDueStatus(bill.start_date) : { label: 'Upcoming', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
              return (
                <div
                  key={`${bill.id}-${bill.start_date}`}
                  className="flex items-center justify-between py-2.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{bill.description}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Due {safeFormat(bill.start_date, (d) => format(d, 'MMM d'))}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium font-mono tabular-nums">{formatPeso(bill.amount, bill.currency)}</div>
                    <Badge variant="outline" className={cn('text-xs mt-1', status.color)}>
                      {status.label}
                    </Badge>
                  </div>
                </div>
              );
            })}

            {inWindow.length > 5 && (
              <div className="text-center text-xs text-muted-foreground pt-2">
                +{inWindow.length - 5} more bills
              </div>
            )}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DollarSign className="h-3 w-3" />
            <span>{inWindow.length} payments due in {days} days</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
