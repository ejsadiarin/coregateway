import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useExpenses, useSearchExpenses, useCategories, useDeleteExpense, useUpdateExpense, useCreateExpense, GuestBlockedError } from "@/hooks/use-budget";
import { ExpenseCard } from "@/components/budget/expense-card";
import { EditExpenseDialog } from "@/components/budget/expense-edit-dialog";
import { ExpenseDetailDialog } from "@/components/budget/expense-detail-dialog";
import { ExpenseFormDialog } from "@/components/budget/expense-form-dialog";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Plus, Filter, ArrowLeft, EyeOff, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ExpenseFilters, Expense, UpdateExpenseRequest, CreateExpenseRequest } from "@/types/api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { Link } from "react-router-dom";

// debounce hook for search input
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default function ExpensesPage() {
  const [filters, setFilters] = useState<ExpenseFilters>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);

  // debounce search to avoid excessive API calls
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // determine if we should use search mode
  const isSearchMode = debouncedSearchTerm.length > 0;

  // regular list query (used when not searching)
  const listQuery = useExpenses(filters, page, limit);

  // search query (used when searching)
  const searchQuery = useSearchExpenses(
    debouncedSearchTerm,
    {
      category_id: filters.category_id,
      start_date: filters.start_date,
      end_date: filters.end_date,
    },
    page,
    limit
  );

  const { data: categories } = useCategories();
  const deleteExpense = useDeleteExpense();
  const updateExpense = useUpdateExpense();
  const createExpense = useCreateExpense();
  const { isGuest } = useAuth();
  const { showToast } = useToast();

  // use appropriate data source based on search mode
  const activeQuery = isSearchMode ? searchQuery : listQuery;
  const expenses = activeQuery.data?.data ?? [];
  const pagination = activeQuery.data?.pagination;
  const isLoading = activeQuery.isLoading;

  // reset to page 1 when search term changes
  useEffect(() => {
    if (debouncedSearchTerm !== searchTerm) return;
    setPage(1);
  }, [debouncedSearchTerm]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClearFilters = () => {
    setFilters({});
    setSearchTerm("");
    setPage(1);
  };

  const hasActiveFilters = !!(filters.category_id || filters.start_date || filters.end_date || searchTerm);

  const handleDelete = async (id: string) => {
    try {
      await deleteExpense.mutateAsync(id);
      showToast("Expense deleted successfully", "success");
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to delete expense", "error");
      }
    }
  };

  const handleUpdate = async (data: UpdateExpenseRequest) => {
    try {
      await updateExpense.mutateAsync({ id: editingExpense!.id, data });
      showToast("Expense updated successfully", "success");
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to update expense", "error");
      }
    }
  };

  const handleView = (expense: Expense) => {
    setViewingExpense(expense);
  };

  const handleCreateExpense = async (data: CreateExpenseRequest | UpdateExpenseRequest) => {
    try {
      await createExpense.mutateAsync(data as CreateExpenseRequest);
      showToast("Expense created successfully", "success");
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to create expense", "error");
      }
    }
  };

  return (
    <div className="px-4 md:px-6 py-6">
      {/* Header */}
      <motion.div
        className="mb-8 flex items-center justify-between"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div>
          <Link to="/dashboard/budget">
            <Button variant="ghost" size="sm" className="mb-2 pl-0">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Budget
            </Button>
          </Link>
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-primary">EXPENSE LIST</h1>
            {isGuest && (
              <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
                Demo Mode
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {isGuest
              ? "Viewing sample expenses"
              : "View and manage all your expenses"}
          </p>
        </div>
        <Button onClick={() => setShowExpenseDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Expense
        </Button>
      </motion.div>

      {/* Filters */}
      <motion.div
        className="mb-6 space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] lg:grid-cols-[1fr_1fr_auto_auto] items-end gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search all expenses..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select
            value={filters.category_id || "all"}
            onValueChange={(value) => {
              setFilters((prev) => ({
                ...prev,
                category_id: value === "all" ? undefined : value,
              }));
              setPage(1);
            }}
          >
            <SelectTrigger>
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories?.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.icon && <span className="mr-2">{category.icon}</span>}
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
            <div className="flex flex-col gap-1">
              <label htmlFor="start-date" className="text-xs text-muted-foreground">
                From
              </label>
              <Input
                id="start-date"
                type="date"
                value={filters.start_date || ""}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, start_date: e.target.value }));
                  setPage(1);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="end-date" className="text-xs text-muted-foreground">
                To (optional)
              </label>
              <Input
                id="end-date"
                type="date"
                value={filters.end_date || ""}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, end_date: e.target.value }));
                  setPage(1);
                }}
              />
            </div>
          </div>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="self-end w-full sm:w-auto"
            >
              Clear Filters
            </Button>
          )}
        </div>

        {/* Pagination Info and Controls at Top */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-b py-4">
            <p className="text-sm text-muted-foreground order-2 sm:order-1">
              Showing {((pagination.page - 1) * pagination.page_size) + 1} to {Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} expenses
            </p>
            <div className="order-1 sm:order-2">
              <Pagination
                currentPage={page}
                totalPages={pagination.totalPages}
                onPageChange={handlePageChange}
                disabled={isLoading}
              />
            </div>
          </div>
        )}
      </motion.div>

      {/* Expense List */}
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : expenses && expenses.length > 0 ? (
          <>
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                onView={handleView}
                onEdit={(exp) => setEditingExpense(exp)}
                onDelete={handleDelete}
                showToast={showToast}
              />
            ))}
            
            {/* Pagination Controls at Bottom */}
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-8 border-t pt-6 flex justify-center">
                <Pagination
                  currentPage={page}
                  totalPages={pagination.totalPages}
                  onPageChange={handlePageChange}
                  disabled={isLoading}
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <div className="space-y-2">
              <EyeOff className="w-8 h-8 mx-auto opacity-50" />
              <p>No expenses found.</p>
              {isGuest ? (
                <p className="text-xs">Sign in or create an account to manage your own expenses.</p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowExpenseDialog(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first expense
                </Button>
              )}
            </div>
          </div>
        )}
      </motion.div>


      {/* Edit Dialog */}
      <EditExpenseDialog
        expense={editingExpense}
        open={!!editingExpense}
        onOpenChange={(open) => !open && setEditingExpense(null)}
        onSubmit={handleUpdate}
      />

      {/* Detail Dialog */}
      <ExpenseDetailDialog
        expense={viewingExpense}
        open={!!viewingExpense}
        onOpenChange={(open) => {
          if (!open) {
            setViewingExpense(null);
          }
        }}
        onEdit={(data) => {
          handleUpdate(data);
          setViewingExpense(null);
        }}
        onDelete={handleDelete}
        showToast={showToast}
        isGuest={isGuest}
      />

      {/* Create Expense Dialog */}
      <ExpenseFormDialog
        open={showExpenseDialog}
        onOpenChange={setShowExpenseDialog}
        onSubmit={handleCreateExpense}
      />
    </div>
  );
}
