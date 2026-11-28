import { useMemo } from "react";
import { useEntries, useKindCategories } from "@/hooks/use-ledger";
import { matchRecords, type RecordRef } from "@/lib/feed-search";

// BudgetMatches is which expenses and incomes a search of the Feed names.
export interface BudgetMatches {
  // Still reading the budget: the search waits.
  loading: boolean;
  // The budget couldn't be read: the search runs without it.
  failed: boolean;
  records: RecordRef[];
  // How many matched; more than records holds when coreban's cap cut them.
  total: number;
}

const NONE: BudgetMatches = { loading: false, failed: false, records: [], total: 0 };

// useBudgetSearch matches every expense and income the web reads against
// term. With enabled false (no search, or one of notes only) there is
// nothing to match or wait for.
export function useBudgetSearch(term: string, enabled: boolean): BudgetMatches {
  const expenses = useEntries("expense");
  const incomes = useEntries("income");
  const expenseCategories = useKindCategories("expense");
  const incomeCategories = useKindCategories("income");
  const queries = [expenses, incomes, expenseCategories, incomeCategories];
  // Offline, a read never saved on this device waits (paused): the search
  // goes on without it rather than waiting for a connection.
  const loading = queries.some((q) => q.isPending && !q.isPaused);
  const failed = queries.some((q) => (q.isError || q.isPaused) && !q.data);

  const matched = useMemo(() => {
    if (!enabled || !expenses.data || !incomes.data || !expenseCategories.data || !incomeCategories.data) {
      return { records: [], total: 0 };
    }
    const names = new Map([...expenseCategories.data, ...incomeCategories.data].map((c) => [c.id, c.name]));
    return matchRecords(term, [...expenses.data, ...incomes.data], (id) => names.get(id));
  }, [enabled, term, expenses.data, incomes.data, expenseCategories.data, incomeCategories.data]);

  if (!enabled) return NONE;
  return { loading: loading && !failed, failed, ...matched };
}
