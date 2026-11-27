import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { deleteBudgetNote, syncBudgetNotes, syncRecordOf } from '@/lib/budget-sync';
import { feedKey } from '@/lib/feed';
import type { BudgetKind } from '@/types/feed';
import {
  fetchExpenseCategories,
  fetchIncomeCategories,
  isUnknownCategoryError,
  fetchTags,
  createTag,
  updateTag,
  deleteTag,
  fetchExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  fetchIncomes,
  createIncome,
  updateIncome,
  deleteIncome,
  fetchBudgetRemaining,
  fetchCategoryBreakdown,
  fetchFiftyThirtyTwenty,
  fetchCurrentTotalMoney,
  fetchPeriodBudget,
  fetchCashFlow
} from '@/lib/api';
import type {
  Category,
  Tag,
  Expense,
  CreateTagRequest,
  UpdateTagRequest,
  CreateExpenseRequest,
  UpdateExpenseRequest,
  ExpenseFilters,
  Income,
  CreateIncomeRequest,
  UpdateIncomeRequest,
  BudgetRemainingResponse,
  CategoryBreakdown,
  PaginatedResponse,
  FiftyThirtyTwentyResponse,
  CurrentTotalMoneyResponse,
  PeriodBudgetResponse,
  CashFlowResponse,
  BudgetPeriod
} from '@/types/api';
import { useAuth } from '@/contexts/auth-context';

export class GuestBlockedError extends Error {
  constructor(message = 'Guest user is read-only. Create an account to save changes') {
    super(message);
    this.name = 'GuestBlockedError';
  }
}

// saveFailureMessage explains a failed write: a stale category says how to
// pick another, a guest gets the read-only reason, anything else the caller's
// summary and the API's message.
export function saveFailureMessage(error: unknown, fallback: string, staleCategory: string): string {
  if (isUnknownCategoryError(error)) return staleCategory;
  if (error instanceof GuestBlockedError) return error.message;
  return `${fallback}${(error as Error).message}`;
}

// query keys for cache management
export const budgetKeys = {
  all: ['budget'] as const,

  categories: () => [...budgetKeys.all, 'categories'] as const,
  categoriesList: () => [...budgetKeys.categories(), 'list'] as const,

  tags: () => [...budgetKeys.all, 'tags'] as const,
  tagsList: () => [...budgetKeys.tags(), 'list'] as const,
  tagDetail: (id: string) => [...budgetKeys.tags(), 'detail', id] as const,

  expenses: () => [...budgetKeys.all, 'expenses'] as const,
  expensesList: (filters?: ExpenseFilters) => [...budgetKeys.expenses(), 'list', filters] as const,
  expenseDetail: (id: string) => [...budgetKeys.expenses(), 'detail', id] as const,

  incomes: () => [...budgetKeys.all, 'incomes'] as const,
  incomeDetail: (id: string) => [...budgetKeys.incomes(), 'detail', id] as const,
  recurringIncomes: () => [...budgetKeys.all, 'recurringIncomes'] as const,
  recurringExpenses: () => [...budgetKeys.all, 'recurringExpenses'] as const,

  budgetRemainingRoot: () => [...budgetKeys.all, 'budgetRemaining'] as const,

  stats: () => [...budgetKeys.all, 'stats'] as const,

  fiftyThirtyTwenty: (startDate?: string, endDate?: string) =>
    [...budgetKeys.stats(), 'fiftyThirtyTwenty', { startDate, endDate }] as const,

  currentTotalMoney: () =>
    [...budgetKeys.all, 'currentTotalMoney'] as const,

  periodBudgetRoot: () => [...budgetKeys.all, 'periodBudget'] as const,
  periodBudget: (period: BudgetPeriod, date: string) =>
    [...budgetKeys.periodBudgetRoot(), { period, date }] as const,

  cashFlowRoot: () => [...budgetKeys.all, 'cashFlow'] as const,
  cashFlow: (period: BudgetPeriod, count: number) =>
    [...budgetKeys.cashFlowRoot(), { period, count }] as const
};

// invalidateMoneyReads refetches every read whose totals a record or rule
// write changes.
export function invalidateMoneyReads(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: budgetKeys.currentTotalMoney() });
  queryClient.invalidateQueries({ queryKey: budgetKeys.periodBudgetRoot() });
  queryClient.invalidateQueries({ queryKey: budgetKeys.cashFlowRoot() });
  queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
  queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
}

// Categories

export const categoryListKey = (kind: 'expense' | 'income') =>
  [...budgetKeys.categories(), kind] as const;

export function useExpenseCategories() {
  return useQuery<Category[]>({
    queryKey: categoryListKey('expense'),
    queryFn: fetchExpenseCategories,
    staleTime: 300000
  });
}

export function useIncomeCategories() {
  return useQuery<Category[]>({
    queryKey: categoryListKey('income'),
    queryFn: fetchIncomeCategories,
    staleTime: 300000
  });
}

// Tags

export function useTags() {
  return useQuery<Tag[]>({
    queryKey: budgetKeys.tagsList(),
    queryFn: fetchTags,
    staleTime: 300000
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: CreateTagRequest) => {
      if (isGuest) throw new GuestBlockedError();
      return createTag(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.tags() });
    }
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTagRequest }) => {
      if (isGuest) throw new GuestBlockedError();
      return updateTag(id, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.tags() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.tagDetail(variables.id) });
    }
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (id: string) => {
      if (isGuest) throw new GuestBlockedError();
      return deleteTag(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.tags() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
    }
  });
}

// Expenses

export function useExpenses(filters?: ExpenseFilters, page: number = 1, pageSize: number = 50) {
  return useQuery<PaginatedResponse<Expense>>({
    queryKey: [...budgetKeys.expensesList(filters), page, pageSize],
    queryFn: () => fetchExpenses({ ...filters, page, page_size: pageSize }),
    staleTime: 60000,
    refetchOnMount: true
  });
}

// Every budget record has a note in the Feed (coreban ADR-0005). A record
// created or re-dated here gets its note placed at once; a record deleted
// here takes its synced note with it. A failure only delays it: the Feed
// syncs everything again when it opens.
function syncNote(queryClient: QueryClient, kind: BudgetKind, record: Expense | Income) {
  syncBudgetNotes([syncRecordOf(kind, record)])
    .then(() => queryClient.invalidateQueries({ queryKey: feedKey }))
    .catch(() => {});
}

function dropNote(queryClient: QueryClient, kind: BudgetKind, id: string) {
  deleteBudgetNote(kind, id)
    .then(() => queryClient.invalidateQueries({ queryKey: feedKey }))
    .catch(() => {});
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: CreateExpenseRequest) => {
      if (isGuest) throw new GuestBlockedError();
      return createExpense(data);
    },
    onSuccess: (record) => {
      syncNote(queryClient, "expense", record);
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      invalidateMoneyReads(queryClient);
    }
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateExpenseRequest }) => {
      if (isGuest) throw new GuestBlockedError();
      return updateExpense(id, data);
    },
    onSuccess: (record, variables) => {
      syncNote(queryClient, "expense", record);
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenseDetail(variables.id) });
      invalidateMoneyReads(queryClient);
    }
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (id: string) => {
      if (isGuest) throw new GuestBlockedError();
      return deleteExpense(id);
    },
    onSuccess: (_, id) => {
      dropNote(queryClient, "expense", id);
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      invalidateMoneyReads(queryClient);
    }
  });
}

export function useIncomes(
  filters?: { start_date?: string; end_date?: string },
  page: number = 1,
  pageSize: number = 50
) {
  return useQuery<PaginatedResponse<Income>>({
    queryKey: [...budgetKeys.incomes(), 'list', filters, page, pageSize],
    queryFn: () => fetchIncomes({ ...filters, page, page_size: pageSize }),
    staleTime: 60000,
    refetchOnMount: true
  });
}

export function useCreateIncome() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: CreateIncomeRequest) => {
      if (isGuest) throw new GuestBlockedError();
      return createIncome(data);
    },
    onSuccess: (record) => {
      syncNote(queryClient, "income", record);
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      invalidateMoneyReads(queryClient);
    }
  });
}

export function useUpdateIncome() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIncomeRequest }) => {
      if (isGuest) throw new GuestBlockedError();
      return updateIncome(id, data);
    },
    onSuccess: (record, variables) => {
      syncNote(queryClient, "income", record);
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomeDetail(variables.id) });
      invalidateMoneyReads(queryClient);
    }
  });
}

export function useDeleteIncome() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (id: string) => {
      if (isGuest) throw new GuestBlockedError();
      return deleteIncome(id);
    },
    onSuccess: (_, id) => {
      dropNote(queryClient, "income", id);
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      invalidateMoneyReads(queryClient);
    }
  });
}

export function useBudgetRemaining() {
  return useQuery<BudgetRemainingResponse>({
    queryKey: budgetKeys.budgetRemainingRoot(),
    queryFn: fetchBudgetRemaining,
    staleTime: 0
  });
}

export function useCategoryBreakdown(startDate?: string, endDate?: string) {
  return useQuery<CategoryBreakdown[]>({
    queryKey: [...budgetKeys.stats(), 'breakdown', { startDate, endDate }],
    queryFn: () => fetchCategoryBreakdown(startDate, endDate),
    staleTime: 60000
  });
}

export function useFiftyThirtyTwenty(startDate?: string, endDate?: string) {
  return useQuery<FiftyThirtyTwentyResponse>({
    queryKey: budgetKeys.fiftyThirtyTwenty(startDate, endDate),
    queryFn: () => fetchFiftyThirtyTwenty(startDate, endDate),
    staleTime: 300000
  });
}

export function useCurrentTotalMoney() {
  return useQuery<CurrentTotalMoneyResponse>({
    queryKey: budgetKeys.currentTotalMoney(),
    queryFn: () => fetchCurrentTotalMoney(),
    staleTime: 300000,
    retry: 1
  });
}

export function usePeriodBudget(period: BudgetPeriod, date: string) {
  return useQuery<PeriodBudgetResponse>({
    queryKey: budgetKeys.periodBudget(period, date),
    queryFn: () => fetchPeriodBudget(period, date),
    staleTime: 60000,
    retry: 1
  });
}

export function useCashFlow(period: BudgetPeriod, count: number) {
  return useQuery<CashFlowResponse>({
    queryKey: budgetKeys.cashFlow(period, count),
    queryFn: () => fetchCashFlow(period, count),
    staleTime: 60000
  });
}

