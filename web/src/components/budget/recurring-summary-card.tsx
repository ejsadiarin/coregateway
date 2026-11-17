
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRecurringIncomes, useRecurringExpenses } from '@/hooks/use-budget';
import { Repeat, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCount, formatSigned, isRecurringType, netCurrencyTotals } from '@/lib/format';
import { monthlyTotals, type MonthlyProjection } from '@/lib/ledger';
import { CurrencyAmounts } from './currency-amounts';

interface RecurringSummaryCardProps {
  className?: string;
}

const projectionsOf = (
  rules: { amount: number | string; currency: string; recurring_type: string }[],
): MonthlyProjection[] =>
  rules.flatMap((rule) =>
    isRecurringType(rule.recurring_type)
      ? [
          {
            amount: rule.amount,
            currency: rule.currency,
            cadence: rule.recurring_type as MonthlyProjection["cadence"],
          },
        ]
      : [],
  );

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

  const incomeProjections = projectionsOf(recurringIncomes ?? []);
  const incomeTotals = monthlyTotals(incomeProjections);
  const activeExpenses = (recurringExpenses || []).filter((r) => r.is_active !== false);
  const expenseProjections = projectionsOf(activeExpenses);
  const expenseTotals = monthlyTotals(expenseProjections);
  const netTotals = netCurrencyTotals(incomeTotals, expenseTotals);
  const netPositive = netTotals.every((t) => t.amount >= 0);
  const netNegative = netTotals.every((t) => t.amount <= 0);
  const netIcon = netPositive
    ? "bg-green-500/10 text-green-500"
    : netNegative
      ? "bg-red-500/10 text-red-500"
      : "bg-muted text-muted-foreground";

  const recurringIncomeCount = incomeProjections.length;
  const recurringExpenseCount = expenseProjections.length;

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
                <CurrencyAmounts
                  totals={incomeTotals}
                  className="text-lg font-semibold font-mono tabular-nums text-green-600"
                />
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
                <CurrencyAmounts
                  totals={expenseTotals}
                  className="text-lg font-semibold font-mono tabular-nums text-red-600"
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCount(recurringExpenseCount)} rules
            </div>
          </div>

          <div className="pt-3 border-t">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("p-2 rounded-full", netIcon)}>
                  <Repeat className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Net cash flow</p>
                  <CurrencyAmounts
                    totals={netTotals}
                    className="text-xl font-bold font-mono tabular-nums"
                    format={(amount, currency) =>
                      formatSigned(amount, amount >= 0 ? 'income' : 'expense', currency)
                    }
                    tone={(total) => (total.amount >= 0 ? "text-green-600" : "text-red-600")}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
