import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { SelectionPill } from '@/components/ui/selection-pill';
import { cn } from '@/lib/utils';
import {
  BUDGET_PERIODS,
  BUDGET_PERIOD_LABELS,
  budgetPeriodBounds,
  budgetPeriodTitle,
  stepBudgetDate,
  todayISODate,
} from '@/lib/budget-period';
import type { BudgetPeriod } from '@/types/api';

interface BudgetPeriodSelectorProps {
  period: BudgetPeriod;
  date: string;
  onChange: (period: BudgetPeriod, date: string) => void;
  className?: string;
}

export function BudgetPeriodSelector({ period, date, onChange, className }: BudgetPeriodSelectorProps) {
  const group = useId();
  const bounds = budgetPeriodBounds(period, date);
  const title = budgetPeriodTitle(period, bounds.start_date, bounds.end_date);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ''}`}>
      <div className="flex items-center gap-1" role="group" aria-label="Budget period">
        {BUDGET_PERIODS.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={value === period ? 'ghost' : 'outline'}
            aria-pressed={value === period}
            className={cn(
              'relative isolate max-md:h-11 max-md:px-3',
              // The chosen period's fill glides to the next choice.
              value === period && 'border border-transparent text-primary-foreground hover:bg-transparent hover:text-primary-foreground',
            )}
            onClick={() => onChange(value, date)}
          >
            {value === period && <SelectionPill group={group} className="rounded-md bg-primary shadow" />}
            {BUDGET_PERIOD_LABELS[value]}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Previous period"
          className="max-md:h-11 max-md:w-11"
          onClick={() => onChange(period, stepBudgetDate(period, date, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[10rem] text-center font-mono text-sm tabular-nums" aria-live="polite">
          {title}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Next period"
          className="max-md:h-11 max-md:w-11"
          onClick={() => onChange(period, stepBudgetDate(period, date, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="max-md:h-11 max-md:px-3"
          onClick={() => onChange(period, todayISODate())}
        >
          Today
        </Button>
      </div>
    </div>
  );
}
