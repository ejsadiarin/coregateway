import type { BudgetPeriod, CashFlowBucket } from "@/types/api";

export const CASH_FLOW_COUNTS: Record<BudgetPeriod, number> = {
  day: 14,
  week: 8,
  month: 6,
};

export const CASH_FLOW_WINDOW_LABELS: Record<BudgetPeriod, string> = {
  day: "Last 14 days",
  week: "Last 8 weeks",
  month: "Last 6 months",
};

/** The tallest bar in the series, with a floor so zero buckets don't divide by zero. */
export function cashFlowMax(buckets: Pick<CashFlowBucket, "income" | "spent">[]): number {
  return Math.max(1, ...buckets.flatMap((bucket) => [Number(bucket.income) || 0, Number(bucket.spent) || 0]));
}

/** A bar is the current, still-running bucket when it is the last one. */
export function isCurrentBucket(index: number, length: number): boolean {
  return length > 0 && index === length - 1;
}
