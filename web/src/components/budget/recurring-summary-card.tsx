
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRecurringIncomes, useRecurringExpenses } from '@/hooks/use-budget';
import { Repeat, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPeso, formatCount, formatSigned } from '@/lib/format';

interface RecurringSummaryCardProps {
  className?: string;
}

export function RecurringSummaryCard({ className }: RecurringSummaryCardProps) {
  const { data: recurringIncomes, isLoading: incomesLoading } = useRecurringIncomes();
  const { data: recurringExpenses, isLoading: expensesLoading } = useRecurringExpenses();

  const isLoading = incomesLoading || expensesLoading;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recurring Cash Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 animate-pulse">
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="h-6 w-40 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalRecurringIncome = recurringIncomes?.reduce(
    (sum, inc) => sum + (Number(inc.amount) || 0),
    0
  ) || 0;

  const activeExpenses = (recurringExpenses || []).filter((r) => r.is_active !== false);
  const totalRecurringExpenses = activeExpenses.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0
  );
  const netRecurringCashFlow = totalRecurringIncome - totalRecurringExpenses;

  const recurringIncomeCount = recurringIncomes?.length || 0;
  const recurringExpenseCount = activeExpenses.length;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Recurring Cash Flow</CardTitle>
        <CardDescription className="text-xs">Monthly equivalents</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-green-500/10">
                <ArrowDownRight className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Income</p>
                <div className="text-lg font-semibold font-mono tabular-nums text-green-600">
                  {formatPeso(totalRecurringIncome)}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCount(recurringIncomeCount)} sources
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-red-500/10">
                <ArrowUpRight className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Expenses</p>
                <div className="text-lg font-semibold font-mono tabular-nums text-red-600">
                  {formatPeso(totalRecurringExpenses)}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCount(recurringExpenseCount)} rules
            </div>
          </div>

          <div className="pt-3 border-t">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "p-2 rounded-full",
                  netRecurringCashFlow >= 0 ? "bg-green-500/10" : "bg-red-500/10"
                )}>
                  <Repeat className={cn(
                    "h-4 w-4",
                    netRecurringCashFlow >= 0 ? "text-green-500" : "text-red-500"
                  )} />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Net cash flow</p>
                  <div className={cn(
                    "text-xl font-bold font-mono tabular-nums",
                    netRecurringCashFlow >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {formatSigned(netRecurringCashFlow, netRecurringCashFlow >= 0 ? 'income' : 'expense')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
