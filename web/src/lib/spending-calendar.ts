import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export const CALENDAR_MAX_DAYS = 62;

export interface CalendarDay {
  date: string;
  spent: number;
  future: boolean;
  noSpend: boolean;
}

/**
 * requiredDayBuckets is how many daily buckets the calendar needs to cover
 * the month containing anchor through today. A future month needs none.
 */
export function requiredDayBuckets(anchor: string, today: string): number {
  const start = startOfMonth(parseISO(anchor));
  if (format(start, "yyyy-MM-dd") > today) return 0;
  return differenceInCalendarDays(parseISO(today), start) + 1;
}

export function calendarAvailable(needed: number): boolean {
  return needed > 0 && needed <= CALENDAR_MAX_DAYS;
}

/**
 * calendarDays lays the month out Monday-first, padding the first and last
 * week with nulls. Future days are left blank rather than shaded as zero;
 * every past day is marked no-spend when it has no spending.
 */
export function calendarDays(
  anchor: string,
  spentByDate: Map<string, number>,
  today: string,
): (CalendarDay | null)[] {
  const start = startOfMonth(parseISO(anchor));
  const end = endOfMonth(start);
  const gridStart = startOfWeek(start, { weekStartsOn: 1 });
  const cells: (CalendarDay | null)[] = [];

  for (let day = gridStart; day < start; day = addDays(day, 1)) cells.push(null);
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const date = format(day, "yyyy-MM-dd");
    const future = date > today;
    const spent = future ? 0 : Number(spentByDate.get(date)) || 0;
    cells.push({ date, spent, future, noSpend: !future && spent === 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function noSpendDays(days: (CalendarDay | null)[]): number {
  return days.filter((day): day is CalendarDay => !!day && !day.future && day.noSpend).length;
}

/** A shade level from 0 (no spend) to 4 (the month's largest day). */
export function spendLevel(spent: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (spent <= 0 || max <= 0) return 0;
  const ratio = spent / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}
