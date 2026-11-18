import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEntries, useRules } from '@/hooks/use-ledger';
import { comingUp, comingUpNet, sevenDayWindow } from '@/lib/coming-up';
import { currencyTotals, formatSigned } from '@/lib/format';
import { CurrencyAmounts } from './currency-amounts';

interface ComingUpCardProps {
  className?: string;
}

export function ComingUpCard({ className }: ComingUpCardProps) {
  const { data: expenseRules = [], isLoading: expenseRulesLoading, error: expenseRulesError } = useRules('expense');
  const { data: incomeRules = [], isLoading: incomeRulesLoading, error: incomeRulesError } = useRules('income');
  const { data: expenseEntries = [], isLoading: expenseLoading, error: expenseError } = useEntries('expense');
  const { data: incomeEntries = [], isLoading: incomeLoading, error: incomeError } = useEntries('income');

  const isLoading = expenseRulesLoading || incomeRulesLoading || expenseLoading || incomeLoading;
  const error = expenseRulesError || incomeRulesError || expenseError || incomeError;
  const window = sevenDayWindow();
  const items = comingUp(expenseRules, expenseEntries, incomeRules, incomeEntries, window);
  const net = currencyTotals(comingUpNet(items), true);
  const shown = items.slice(0, 8);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Coming up</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Rules and future expenses · next 7 days</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Net</p>
            <CurrencyAmounts
              totals={net}
              className="text-lg font-semibold font-mono tabular-nums"
              tone={(total) => (total.amount < 0 ? 'text-destructive' : 'text-[var(--chart-2)]')}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">Failed to load what is coming up</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing coming up in the next 7 days.</p>
        ) : (
          <>
            <div className="divide-y divide-border/60">
              {shown.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                        {format(parseISO(item.date), 'EEE d MMM')}
                      </span>
                      <span className="truncate text-sm font-medium">{item.description}</span>
                    </div>
                    <p
                      className={`mt-0.5 pl-18 font-mono text-[10px] uppercase tracking-[0.18em] ${
                        item.kind === 'income' ? 'text-[var(--chart-2)]' : 'text-destructive'
                      }`}
                    >
                      {item.kind}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {formatSigned(item.amount, item.kind, item.currency)}
                  </p>
                </div>
              ))}
            </div>
            {items.length > shown.length && (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                +{items.length - shown.length} more
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
