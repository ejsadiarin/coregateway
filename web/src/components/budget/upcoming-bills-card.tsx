
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useEntries, useRules } from '@/hooks/use-ledger';
import { Calendar, Clock, DollarSign } from 'lucide-react';
import { safeFormat } from '@/lib/utils';
import { formatPeso, totalsByCurrency } from '@/lib/format';
import { CurrencyAmounts } from './currency-amounts';
import { dueAmounts, upcomingDues } from '@/lib/upcoming-bills';
import { format, addDays, startOfDay } from 'date-fns';

interface UpcomingBillsCardProps {
  days?: 7 | 30;
  className?: string;
}

export function UpcomingBillsCard({ days = 30, className }: UpcomingBillsCardProps) {
  const { data: rules = [], isLoading: rulesLoading, error: rulesError } = useRules("expense");
  const { data: entries = [], isLoading: entriesLoading, error: entriesError } = useEntries("expense");
  const isLoading = rulesLoading || entriesLoading;
  const error = rulesError || entriesError;

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

  if (error) {
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

  const windowStart = startOfDay(new Date());
  const from = format(windowStart, "yyyy-MM-dd");
  const until = format(addDays(windowStart, days - 1), "yyyy-MM-dd");

  const due = upcomingDues(rules.filter((rule) => rule.active), entries, from, until);
  const totalDue = totalsByCurrency(dueAmounts(due));
  const displayedDues = due.slice(0, 5);

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
            <CurrencyAmounts totals={totalDue} className="text-2xl font-bold font-mono tabular-nums" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {due.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No bills due in the next {days} days
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {displayedDues.map((rule) => {
              const next = rule.dates[0];
              return (
                <div
                  key={`${rule.id}-${next}`}
                  className="flex items-center justify-between py-2.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{rule.description}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Due {safeFormat(next, (d) => format(d, 'MMM d'))}
                        {rule.dates.length > 1 && <span> · {rule.dates.length} due dates</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium font-mono tabular-nums">
                      {formatPeso(rule.amount, rule.currency)}
                      {rule.dates.length > 1 && (
                        <span className="text-muted-foreground"> × {rule.dates.length}</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs mt-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                      Soon
                    </Badge>
                  </div>
                </div>
              );
            })}

            {due.length > 5 && (
              <div className="text-center text-xs text-muted-foreground pt-2">
                +{due.length - 5} more bills
              </div>
            )}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DollarSign className="h-3 w-3" />
            <span>
              {due.length} {due.length === 1 ? "bill" : "bills"} due in {days} days
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
