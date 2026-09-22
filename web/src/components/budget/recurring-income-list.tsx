
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRecurringIncomes, useCreateIncome } from '@/hooks/use-budget';
import { SkipForward, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { safeFormat } from "@/lib/utils";
import { formatSigned, formatCount } from "@/lib/format";
import { SkipOccurrenceDialog } from './skip-occurrence-dialog';
import type { RecurringIncomeWithNextDate } from '@/types/api';

interface RecurringIncomeListProps {
  className?: string;
}

export function RecurringIncomeList({ className }: RecurringIncomeListProps) {
  const { data: recurringIncomes, isLoading } = useRecurringIncomes();
  const [skippingIncome, setSkippingIncome] = useState<RecurringIncomeWithNextDate | null>(null);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Recurring Incomes</CardTitle>
          <CardDescription>Your regular income sources</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 animate-pulse">
                <div className="h-10 w-10 bg-muted rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/2 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!recurringIncomes || recurringIncomes.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Recurring Incomes</CardTitle>
          <CardDescription>Your regular income sources</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No recurring incomes yet</p>
            <p className="text-xs mt-1">Add recurring income to track expected earnings</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recurring Incomes</CardTitle>
              <CardDescription>Your regular income sources</CardDescription>
            </div>
            <Badge variant="secondary">{formatCount(recurringIncomes.length)} sources</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recurringIncomes.map((income) => (
              <div
                key={income.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-border transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">
                      {income.description || 'Income'}
                    </p>
                    {income.recurring_type && (
                      <Badge variant="outline" className="text-xs">
                        {income.recurring_type}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    <span>Starts: {safeFormat(income.start_date, (d) => format(d, 'MMM d, yyyy'))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-semibold font-mono tabular-nums text-green-600">
                      {formatSigned(income.amount, "income", income.currency)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSkippingIncome(income)}
                    title="Skip this occurrence"
                  >
                    <SkipForward className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <SkipOccurrenceDialog
        income={skippingIncome}
        open={!!skippingIncome}
        onOpenChange={(open) => {
          if (!open) setSkippingIncome(null);
        }}
      />
    </>
  );
}
