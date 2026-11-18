import type { CategoryBreakdown } from "@/types/api";

export type ChangeDirection = "up" | "down" | "flat";

export interface CategoryChange {
  category_id: string;
  category_name: string;
  category_color?: string;
  amount: number;
  share: number;
  previous: number;
  change: number;
  direction: ChangeDirection;
  isNew: boolean;
}

const amountOf = (row: CategoryBreakdown) => Number(row.total_amount) || 0;

/**
 * compareCategories pairs the current period's categories with the previous
 * period's by id, keeping the API's largest-first order. A category with no
 * previous spending is new; a missing current category simply drops out.
 */
export function compareCategories(
  current: CategoryBreakdown[],
  previous: CategoryBreakdown[],
): CategoryChange[] {
  const before = new Map(previous.map((row) => [row.category_id, amountOf(row)]));
  const spentRows = current.filter((row) => amountOf(row) > 0);
  const spent = spentRows.reduce((sum, row) => sum + amountOf(row), 0);

  return spentRows.map((row) => {
    const amount = amountOf(row);
    const previousAmount = before.get(row.category_id) ?? 0;
    const change = amount - previousAmount;
    return {
      category_id: row.category_id,
      category_name: row.category_name,
      category_color: row.category_color,
      amount,
      share: spent > 0 ? amount / spent : 0,
      previous: previousAmount,
      change,
      direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
      isNew: previousAmount === 0 && amount > 0,
    };
  });
}

export interface NeedsWantsSplit {
  needs: number;
  wants: number;
  savings: number;
  total: number;
  needsShare: number;
  wantsShare: number;
}

/** The priority split of a period's spent, with shares of its total. */
export function needsWantsSplit(needs: number, wants: number, savings: number): NeedsWantsSplit {
  const total = needs + wants + savings;
  return {
    needs,
    wants,
    savings,
    total,
    needsShare: total > 0 ? needs / total : 0,
    wantsShare: total > 0 ? wants / total : 0,
  };
}
