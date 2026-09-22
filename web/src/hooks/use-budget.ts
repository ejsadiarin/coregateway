import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  fetchTags,
  fetchTag,
  createTag,
  updateTag,
  deleteTag,
  fetchExpenses,
  fetchExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  searchExpenses,
  fetchIncomes,
  fetchIncome,
  createIncome,
  updateIncome,
  deleteIncome,
  exportBudgetJSON,
  importBudgetJSON,
  skipIncome,
  skipExpense,
  fetchRecurringIncomes,
  fetchRecurringExpenses,
  fetchIncomeOccurrences,
  fetchBudgetRemaining,
  fetchSummaryStats,
  fetchCategoryBreakdown,
  fetchTrends,
  fetchSavingsRate,
  fetchSpendingVelocity,
  fetchUpcomingBills,
  fetchPriorityGroups,
  fetchFiftyThirtyTwenty,
  fetchMonthOverMonth,
  fetchCurrentTotalMoney
} from '@/lib/api';
import type { ExpenseSearchParams } from '@/lib/api';
import type {
  Category,
  Tag,
  Expense,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateTagRequest,
  UpdateTagRequest,
  CreateExpenseRequest,
  UpdateExpenseRequest,
  ExpenseFilters,
  Income,
  RecurringIncomeWithNextDate,
  RecurringExpenseRule,
  IncomeOccurrence,
  CreateIncomeRequest,
  UpdateIncomeRequest,
  BudgetRemainingResponse,
  SummaryStats,
  CategoryBreakdown,
  TrendItem,
  PaginatedResponse,
  BudgetExportPayload,
  BudgetImportResult,
  SkipIncomeRequest,
  SkipExpenseRequest,
  PriorityGroup,
  SavingsRateResponse,
  SpendingVelocityResponse,
  UpcomingBillsResponse,
  FiftyThirtyTwentyResponse,
  MonthOverMonthResponse,
  CurrentTotalMoneyResponse,
  MerchantAnalysisResponse,
  HealthScoreResponse,
  WeekdayPatternResponse
} from '@/types/api';
import { useAuth } from '@/contexts/auth-context';

export class GuestBlockedError extends Error {
  constructor(message = 'Guest user is read-only. Create an account to save changes') {
    super(message);
    this.name = 'GuestBlockedError';
  }
}

// query keys for cache management
export const budgetKeys = {
  all: ['budget'] as const,

  categories: () => [...budgetKeys.all, 'categories'] as const,
  categoriesList: () => [...budgetKeys.categories(), 'list'] as const,

  priorityGroups: () => [...budgetKeys.all, 'priorityGroups'] as const,

  tags: () => [...budgetKeys.all, 'tags'] as const,
  tagsList: () => [...budgetKeys.tags(), 'list'] as const,
  tagDetail: (id: string) => [...budgetKeys.tags(), 'detail', id] as const,

  subscriptions: () => [...budgetKeys.all, 'subscriptions'] as const,

  expenses: () => [...budgetKeys.all, 'expenses'] as const,
  expensesList: (filters?: ExpenseFilters) => [...budgetKeys.expenses(), 'list', filters] as const,
  expensesSearch: (query: string, filters?: Omit<ExpenseSearchParams, 'q'>) =>
    [...budgetKeys.expenses(), 'search', query, filters] as const,
  expenseDetail: (id: string) => [...budgetKeys.expenses(), 'detail', id] as const,

  incomes: () => [...budgetKeys.all, 'incomes'] as const,
  incomeDetail: (id: string) => [...budgetKeys.incomes(), 'detail', id] as const,
  incomeOccurrences: (startDate: string, endDate: string) =>
    [...budgetKeys.incomes(), 'occurrences', { startDate, endDate }] as const,
  recurringIncomes: () => [...budgetKeys.all, 'recurringIncomes'] as const,
  recurringExpenses: () => [...budgetKeys.all, 'recurringExpenses'] as const,

  budgetRemainingRoot: () => [...budgetKeys.all, 'budgetRemaining'] as const,

  stats: () => [...budgetKeys.all, 'stats'] as const,

  savingsRate: (startDate?: string, endDate?: string) =>
    [...budgetKeys.stats(), 'savingsRate', { startDate, endDate }] as const,
  spendingVelocity: (startDate?: string, endDate?: string) =>
    [...budgetKeys.stats(), 'spendingVelocity', { startDate, endDate }] as const,
  upcomingBills: () => [...budgetKeys.all, 'upcomingBills'] as const,

  fiftyThirtyTwenty: (startDate?: string, endDate?: string) =>
    [...budgetKeys.stats(), 'fiftyThirtyTwenty', { startDate, endDate }] as const,
  monthOverMonth: () => [...budgetKeys.stats(), 'monthOverMonth'] as const,

  currentTotalMoney: () =>
    [...budgetKeys.all, 'currentTotalMoney'] as const
};

// Categories

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: budgetKeys.categoriesList(),
    queryFn: fetchCategories,
    staleTime: 300000
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: CreateCategoryRequest) => {
      if (isGuest) throw new GuestBlockedError();
      return createCategory(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.categories() });
    }
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryRequest }) => {
      if (isGuest) throw new GuestBlockedError();
      return updateCategory(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.categories() });
    }
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (id: string) => {
      if (isGuest) throw new GuestBlockedError();
      return deleteCategory(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.categories() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
    }
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

export function useTag(id: string | null) {
  return useQuery<Tag>({
    queryKey: budgetKeys.tagDetail(id ?? ''),
    queryFn: () => fetchTag(id!),
    enabled: !!id
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

export function useExpense(id: string | null) {
  return useQuery<Expense>({
    queryKey: budgetKeys.expenseDetail(id ?? ''),
    queryFn: () => fetchExpense(id!),
    enabled: !!id
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: CreateExpenseRequest) => {
      if (isGuest) throw new GuestBlockedError();
      return createExpense(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenseDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
    }
  });
}

export function useSearchExpenses(
  query: string,
  filters?: { category_id?: string; start_date?: string; end_date?: string },
  page: number = 1,
  pageSize: number = 50
) {
  return useQuery<PaginatedResponse<Expense>>({
    queryKey: budgetKeys.expensesSearch(query, { ...filters, page, page_size: pageSize }),
    queryFn: () => searchExpenses({ q: query, ...filters, page, page_size: pageSize }),
    enabled: query.length > 0,
    staleTime: 60000,
    refetchOnMount: true
  });
}

// Incomes

export function useIncomes(
  filters?: { start_date?: string; end_date?: string; recurring_type?: string },
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

export function useIncome(id: string | null) {
  return useQuery<Income>({
    queryKey: budgetKeys.incomeDetail(id ?? ''),
    queryFn: () => fetchIncome(id!),
    enabled: !!id
  });
}

export function useRecurringIncomes() {
  return useQuery<RecurringIncomeWithNextDate[]>({
    queryKey: budgetKeys.recurringIncomes(),
    queryFn: fetchRecurringIncomes,
    staleTime: 300000
  });
}

export function useRecurringExpenses() {
  return useQuery<RecurringExpenseRule[]>({
    queryKey: budgetKeys.recurringExpenses(),
    queryFn: fetchRecurringExpenses,
    staleTime: 300000
  });
}

export function useIncomeOccurrences(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 50,
  enabled: boolean = true
) {
  return useQuery<PaginatedResponse<IncomeOccurrence>>({
    queryKey: [...budgetKeys.incomeOccurrences(startDate, endDate), page, pageSize],
    queryFn: () => fetchIncomeOccurrences({ start_date: startDate, end_date: endDate, page, page_size: pageSize }),
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 60000
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.recurringIncomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomeDetail(variables.id) });
      queryClient.invalidateQueries({ queryKey: budgetKeys.recurringIncomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.recurringIncomes() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.budgetRemainingRoot() });
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });
    }
  });
}

export function useExportBudgetJSON() {
  return useMutation({
    mutationFn: exportBudgetJSON
  });
}

export function useImportBudgetJSON() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (payload: BudgetExportPayload): Promise<BudgetImportResult> => {
      if (isGuest) throw new GuestBlockedError('Guest users cannot import budget data');
      return importBudgetJSON(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    }
  });
}

export function useSkipIncome() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: SkipIncomeRequest) => {
      if (isGuest) throw new GuestBlockedError('Guest users cannot skip incomes');
      return skipIncome(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    }
  });
}

export function useSkipExpense() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuth();

  return useMutation({
    mutationFn: (data: SkipExpenseRequest) => {
      if (isGuest) throw new GuestBlockedError('Guest users cannot skip expenses');
      return skipExpense(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
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

// Statistics

export function useSummaryStats(startDate?: string, endDate?: string) {
  return useQuery<SummaryStats>({
    queryKey: [...budgetKeys.stats(), 'summary', { startDate, endDate }],
    queryFn: () => fetchSummaryStats(startDate, endDate),
    staleTime: 60000,
    refetchOnMount: true
  });
}

export function useCategoryBreakdown(startDate?: string, endDate?: string) {
  return useQuery<CategoryBreakdown[]>({
    queryKey: [...budgetKeys.stats(), 'breakdown', { startDate, endDate }],
    queryFn: () => fetchCategoryBreakdown(startDate, endDate),
    staleTime: 60000
  });
}

export function useTrends(startDate?: string, endDate?: string) {
  return useQuery<TrendItem[]>({
    queryKey: [...budgetKeys.stats(), 'trends', { startDate, endDate }],
    queryFn: () => fetchTrends(startDate, endDate),
    staleTime: 60000
  });
}

// Budget Analytics

export function useSavingsRate(startDate?: string, endDate?: string) {
  return useQuery<SavingsRateResponse>({
    queryKey: budgetKeys.savingsRate(startDate, endDate),
    queryFn: () => fetchSavingsRate(startDate, endDate),
    staleTime: 300000
  });
}

export function useSpendingVelocity(startDate?: string, endDate?: string) {
  return useQuery<SpendingVelocityResponse>({
    queryKey: budgetKeys.spendingVelocity(startDate, endDate),
    queryFn: () => fetchSpendingVelocity(startDate!, endDate!),
    staleTime: 60000,
    enabled: !!startDate && !!endDate
  });
}

export function useUpcomingBills() {
  return useQuery<UpcomingBillsResponse>({
    queryKey: budgetKeys.upcomingBills(),
    queryFn: fetchUpcomingBills,
    staleTime: 300000
  });
}

export function usePriorityGroups() {
  return useQuery<PriorityGroup[]>({
    queryKey: budgetKeys.priorityGroups(),
    queryFn: fetchPriorityGroups,
    staleTime: 300000
  });
}

// Financial Health

export function useFiftyThirtyTwenty(startDate?: string, endDate?: string) {
  return useQuery<FiftyThirtyTwentyResponse>({
    queryKey: budgetKeys.fiftyThirtyTwenty(startDate, endDate),
    queryFn: () => fetchFiftyThirtyTwenty(startDate, endDate),
    staleTime: 300000
  });
}

export function useMonthOverMonth(startDate?: string, endDate?: string) {
  return useQuery<MonthOverMonthResponse>({
    queryKey: [...budgetKeys.monthOverMonth(), { startDate, endDate }],
    queryFn: () => fetchMonthOverMonth(startDate, endDate),
    staleTime: 300000
  });
}

export function useCurrentTotalMoney() {
  return useQuery<CurrentTotalMoneyResponse>({
    queryKey: budgetKeys.currentTotalMoney(),
    queryFn: () => fetchCurrentTotalMoney(),
    staleTime: 300000
  });
}

// Stub hooks for endpoints not yet implemented in corefinance backend

export function useHealthScore() {
  return useQuery<HealthScoreResponse>({
    queryKey: ['budget', 'stats', 'healthScore'],
    queryFn: async () => { throw new Error('Health score endpoint not implemented'); },
    enabled: false,
    staleTime: Infinity
  });
}

export function useWeekdayPattern(_startDate?: string, _endDate?: string) {
  return useQuery<WeekdayPatternResponse[]>({
    queryKey: ['budget', 'stats', 'weekdayPattern'],
    queryFn: async () => { throw new Error('Weekday pattern endpoint not implemented'); },
    enabled: false,
    staleTime: Infinity
  });
}

export function useMerchantAnalysis(_limit: number = 10, _startDate?: string, _endDate?: string) {
  return useQuery<MerchantAnalysisResponse>({
    queryKey: ['budget', 'stats', 'merchantAnalysis'],
    queryFn: async () => { throw new Error('Merchant analysis endpoint not implemented'); },
    enabled: false,
    staleTime: Infinity
  });
}
