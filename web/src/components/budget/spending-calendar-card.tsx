import { format, parseISO, startOfMonth } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCashFlow } from '@/hooks/use-budget';
import { todayISODate } from '@/lib/budget-period';
import { formatPeso } from '@/lib/format';
import {
  CALENDAR_MAX_DAYS,
  calendarAvailable,
  calendarDays,
  noSpendDays,
  requiredDayBuckets,
  spendLevel,
} from '@/lib/spending-calendar';

interface SpendingCalendarCardProps {
  date: string;
  onSelectDay: (date: string) => void;
  className?: string;
}

const SHADES = ['bg-muted/20', 'bg-primary/15', 'bg-primary/30', 'bg-primary/50', 'bg-primary/70'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SpendingCalendarCard({ date, onSelectDay, className }: SpendingCalendarCardProps) {
  const today = todayISODate();
  const month = startOfMonth(parseISO(date));
  const monthTitle = format(month, 'MMMM yyyy');
  const needed = requiredDayBuckets(date, today);
  const available = calendarAvailable(needed);
  const { data, isLoading, error } = useCashFlow('day', available ? needed : 1);

  const spentByDate = new Map<string, number>();
  for (const bucket of data?.buckets ?? []) {
    spentByDate.set(bucket.start_date, Number(bucket.spent) || 0);
  }
  const days = calendarDays(date, spentByDate, today);
  const maxSpent = Math.max(1, ...days.map((day) => day?.spent ?? 0));
  const noSpend = noSpendDays(days);

  return (
    <Card className={className} data-testid="spending-calendar-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium text-muted-foreground">Spending calendar</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{monthTitle}</p>
          </div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
            {noSpend} no-spend {noSpend === 1 ? 'day' : 'days'} so far
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {!available ? (
          <p className="text-sm text-muted-foreground">
            {needed === 0
              ? 'This month has not started yet.'
              : `The calendar only keeps the last ${CALENDAR_MAX_DAYS} days.`}
          </p>
        ) : isLoading ? (
          <div className="grid grid-cols-7 gap-1 animate-pulse">
            {[...Array(35)].map((_, i) => (
              <div key={i} className="aspect-square rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">Failed to load the calendar</p>
        ) : (
          <>
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center font-mono text-[10px] text-muted-foreground sm:gap-1">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
              {days.map((day, index) => {
                if (!day) return <span key={`blank-${index}`} aria-hidden="true" />;
                const isToday = day.date === today;
                const label = day.future
                  ? `${format(parseISO(day.date), 'd MMMM yyyy')}: upcoming`
                  : day.noSpend
                    ? `${format(parseISO(day.date), 'd MMMM yyyy')}: no spend`
                    : `${format(parseISO(day.date), 'd MMMM yyyy')}: ${formatPeso(day.spent)} spent`;
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={day.future}
                    aria-label={label}
                    title={label}
                    onClick={() => onSelectDay(day.date)}
                    className={`flex aspect-square min-h-11 flex-col items-center justify-center rounded border text-xs font-mono tabular-nums transition-colors ${
                      day.future
                        ? 'border-transparent text-muted-foreground/30'
                        : `${SHADES[spendLevel(day.spent, maxSpent)]} border-border/40 hover:border-primary/60`
                    } ${isToday ? 'ring-1 ring-primary' : ''} ${
                      day.noSpend && !day.future ? 'border-dashed border-primary/40' : ''
                    }`}
                  >
                    <span>{format(parseISO(day.date), 'd')}</span>
                    {day.noSpend && !day.future && <span className="mt-0.5 h-1 w-1 rounded-full bg-primary/60" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
