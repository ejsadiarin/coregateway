import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { BudgetPeriod } from "@/types/api";

export const BUDGET_PERIODS: BudgetPeriod[] = ["day", "week", "month"];

export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

export const ISO_DATE = "yyyy-MM-dd";

/** The browser's local calendar date, the owner's day. */
export function todayISODate(now = new Date()): string {
  return format(now, ISO_DATE);
}

export function budgetPeriodFrom(value: string | null): BudgetPeriod {
  return value === "week" || value === "month" ? value : "day";
}

export function budgetDateFrom(value: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = parseISO(value);
    if (isValid(parsed)) return value;
  }
  return todayISODate();
}

export interface BudgetDateRange {
  start_date: string;
  end_date: string;
}

/** The local bounds of the day, Monday-based week or month containing date. */
export function budgetPeriodBounds(period: BudgetPeriod, date: string): BudgetDateRange {
  const day = parseISO(date);
  switch (period) {
    case "week":
      return {
        start_date: format(startOfWeek(day, { weekStartsOn: 1 }), ISO_DATE),
        end_date: format(endOfWeek(day, { weekStartsOn: 1 }), ISO_DATE),
      };
    case "month":
      return {
        start_date: format(startOfMonth(day), ISO_DATE),
        end_date: format(endOfMonth(day), ISO_DATE),
      };
    default:
      return { start_date: date, end_date: date };
  }
}

/** Step one period forward (1) or back (-1), landing inside the new period. */
export function stepBudgetDate(period: BudgetPeriod, date: string, direction: 1 | -1): string {
  const day = parseISO(date);
  switch (period) {
    case "week":
      return format(addWeeks(day, direction), ISO_DATE);
    case "month":
      return format(addMonths(startOfMonth(day), direction), ISO_DATE);
    default:
      return format(addDays(day, direction), ISO_DATE);
  }
}

export function budgetPeriodTitle(period: BudgetPeriod, start: string, end: string): string {
  switch (period) {
    case "week":
      return `${format(parseISO(start), "d MMM")} – ${format(parseISO(end), "d MMM yyyy")}`;
    case "month":
      return format(parseISO(start), "MMMM yyyy");
    default:
      return format(parseISO(start), "EEE d MMM yyyy");
  }
}
