import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ExpenseStats } from "@/components/budget/expense-stats";
import { IncomeForm } from "@/components/budget/income-form";
import { ExpenseFormDialog } from "@/components/budget/expense-form-dialog";
import {
  SavingsRateCard,
  SpendingVelocityCard,
  UpcomingBillsCard,
  RecurringSummaryCard,
  RecurringIncomeList,
  CurrentTotalMoneyCard,
  PeriodPresetFilter
} from "@/components/budget";
import type { PeriodPresetFilterValue } from "@/components/budget";
import {
  useSummaryStats,
  useExpenses,
  useIncomeOccurrences,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
  useUpdateExpense,
  useDeleteExpense,
  useCreateExpense,
  useBudgetRemaining,
} from "@/hooks/use-budget";
import { GuestBlockedError } from "@/hooks/use-budget";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { safeFormat } from "@/lib/utils";
import { formatPeso, formatSigned } from "@/lib/format";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { ExpenseDetailDialog } from "@/components/budget/expense-detail-dialog";
import type { Expense, Income, CreateIncomeRequest, UpdateIncomeRequest, CreateExpenseRequest, UpdateExpenseRequest } from "@/types/api";

export default function BudgetDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Single global period filter (7D default); all period-scoped cards derive from this.
  // Total Money is lifetime-scoped and does not consume dateRange.
  const [dateRange, setDateRange] = useState<PeriodPresetFilterValue>(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    return { startDate: fmt(start), endDate: fmt(today), preset: '7d' };
  });

  const { data: summaryStats, isLoading: statsLoading } = useSummaryStats(dateRange.startDate, dateRange.endDate);
  const { data: expensesData, isLoading: expensesLoading } = useExpenses(
    dateRange.startDate && dateRange.endDate
      ? { start_date: dateRange.startDate, end_date: dateRange.endDate }
      : undefined,
    1,
    5
  );
  const { data: budgetRemainingData } = useBudgetRemaining();

  // recent incomes follow the same global period filter as everything else
  const { data: recentOccurrences, isLoading: occurrencesLoading } = useIncomeOccurrences(
    dateRange.startDate,
    dateRange.endDate,
    1,
    10
  );
  const { isGuest } = useAuth();
  const { showToast } = useToast();

  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);

  // check for query param to open expense dialog (deep linking support)
  useEffect(() => {
    const openExpense = searchParams.get("openExpense");
    if (openExpense === "true") {
      setShowExpenseDialog(true);
      // remove query param from URL
      navigate("/dashboard/budget", { replace: true });
    }
  }, [searchParams, navigate]);

  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const createIncome = useCreateIncome();
  const createExpense = useCreateExpense();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();

  const displayExpenses = expensesData?.data || [];

  const handleActionClick = () => {
    if (isGuest) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
    }
  };

  const handleEditExpense = async (data: any) => {
    try {
      if (!viewingExpense) return;
      await updateExpense.mutateAsync({ id: viewingExpense.id, data });
      showToast("Expense updated successfully", "success");
      setViewingExpense(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to update expense", "error");
      }
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteExpense.mutateAsync(id);
      showToast("Expense deleted successfully", "success");
      setViewingExpense(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to delete expense", "error");
      }
    }
  };

  const handleCreateIncome = async (data: CreateIncomeRequest | UpdateIncomeRequest) => {
    try {
      await createIncome.mutateAsync(data as CreateIncomeRequest);
      showToast("Income created successfully", "success");
      setShowIncomeForm(false);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to create income", "error");
      }
    }
  };

  const handleUpdateIncome = async (data: UpdateIncomeRequest) => {
    try {
      if (!editingIncome) return;
      await updateIncome.mutateAsync({ id: editingIncome.id, data });
      showToast("Income updated successfully", "success");
      setEditingIncome(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to update income", "error");
      }
    }
  };

  const handleDeleteIncome = async (income: Income) => {
    try {
      await deleteIncome.mutateAsync(income.id);
      showToast("Income deleted successfully", "success");
      setEditingIncome(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to delete income", "error");
      }
    }
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
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-primary">BUDGET TRACKER</h1>
            {isGuest && (
              <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
                Demo Mode
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {isGuest
              ? "Viewing sample data. Register to create your own budget."
              : "Track and manage your expenses and income"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { handleActionClick(); if (!isGuest) setShowIncomeForm(true); }}
            disabled={isGuest}
            title={isGuest ? "Guest user is read-only. Create an account to save changes" : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Income
          </Button>
          <Button
            onClick={() => { handleActionClick(); if (!isGuest) setShowExpenseDialog(true); }}
            disabled={isGuest}
            title={isGuest ? "Guest user is read-only. Create an account to save changes" : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </motion.div>

      {/* Budget Remaining (current month — lifetime scope shown on Total Money card) */}
      <motion.div
        className="mb-4 flex items-center justify-between"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="flex items-center gap-3">
          {budgetRemainingData && (
            <>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
                Remaining · {budgetRemainingData.period_start} → {budgetRemainingData.period_end}
              </p>
              <span className={`font-mono tabular-nums text-sm font-semibold ${
                budgetRemainingData.remaining < 0 ? 'text-red-500' :
                budgetRemainingData.remaining > 0 ? 'text-green-600' :
                'text-gray-600'
              }`}>
                {formatPeso(budgetRemainingData.remaining)}
              </span>
              {budgetRemainingData.remaining < 0 && (
                <Badge variant="destructive" className="text-xs">Over Budget</Badge>
              )}
              {budgetRemainingData.remaining > 0 && (
                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">On Track</Badge>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* Global Period Filter — controls every period-scoped card below */}
      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <PeriodPresetFilter value={dateRange} onChange={setDateRange} />
      </motion.div>

      {/* Summary Statistics */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18 }}
      >
        <ExpenseStats stats={summaryStats} isLoading={statsLoading} />
      </motion.div>

      {/* Budget Analytics Cards */}
      <motion.div
        className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <CurrentTotalMoneyCard />
        <SavingsRateCard startDate={dateRange.startDate || undefined} endDate={dateRange.endDate || undefined} />
        <SpendingVelocityCard startDate={dateRange.startDate || undefined} endDate={dateRange.endDate || undefined} />
        <RecurringSummaryCard />
      </motion.div>

      {/* Recurring Income and Bills */}
      <motion.div
        className="mb-8 grid gap-6 lg:grid-cols-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <RecurringIncomeList />
        <UpcomingBillsCard days={7} />
      </motion.div>

      {/* Recent Transactions */}
      <motion.div
        className="grid gap-6 lg:grid-cols-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
      >
        {/* Recent Incomes */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Incomes</CardTitle>
                <CardDescription>Selected period (including recurring)</CardDescription>
              </div>
              <Link to="/dashboard/budget/incomes">
                <Button variant="ghost" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {occurrencesLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4 animate-pulse">
                    <div className="h-10 w-10 bg-muted rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-muted rounded" />
                      <div className="h-3 w-1/2 bg-muted rounded" />
                    </div>
                    <div className="h-6 w-20 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : !recentOccurrences?.data?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No incomes in the selected period</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  disabled={isGuest}
                  title={isGuest ? "Guest user is read-only. Create an account to save changes" : undefined}
                  onClick={() => { handleActionClick(); if (!isGuest) setShowIncomeForm(true); }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first income
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {recentOccurrences.data.map((occ) => (
                  <div
                    key={occ.id}
                    className={`flex items-center justify-between py-2.5 transition-colors ${occ.is_skipped ? 'bg-red-500/5' : ''} ${occ.is_virtual ? 'cursor-default' : 'cursor-pointer hover:bg-accent/50'}`}
                    onClick={() => {
                      if (!occ.is_virtual) {
                        // for real entries, allow editing
                        const incomeForEdit: Income = {
                          id: occ.source_income_id,
                          amount: occ.amount,
                          currency: occ.currency,
                          date: occ.date,
                          description: occ.description,
                          recurring_type: (occ.recurring_type as "one-time" | "daily" | "weekly" | "monthly" | "yearly") || "one-time",
                          priority: "need",
                          status: "posted",
                          created_at: '',
                          updated_at: ''
                        };
                        setEditingIncome(incomeForEdit);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${occ.is_skipped ? 'line-through text-muted-foreground' : ''}`}>
                        {occ.description || (occ.is_skipped ? "Skipped Income" : "Income")}
                        {occ.is_virtual && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            {occ.recurring_type || 'recurring'}
                          </Badge>
                        )}
                        {occ.is_skipped && (
                          <Badge variant="destructive" className="ml-2 text-xs">
                            Skipped
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {safeFormat(occ.date, (d) => formatDistanceToNow(d, { addSuffix: true }))}
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className={`font-semibold font-mono tabular-nums shrink-0 ${occ.is_skipped ? 'text-red-600' : 'text-green-600'}`}>
                        {occ.is_skipped ? formatPeso(Math.abs(Number(occ.amount)), occ.currency) : formatSigned(occ.amount, "income", occ.currency)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Expenses */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Expenses</CardTitle>
                <CardDescription>Your latest transactions</CardDescription>
              </div>
              <Link to="/dashboard/budget/expenses">
                <Button variant="ghost" size="sm">
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4 animate-pulse">
                    <div className="h-10 w-10 bg-muted rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-muted rounded" />
                      <div className="h-3 w-1/2 bg-muted rounded" />
                    </div>
                    <div className="h-6 w-20 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : displayExpenses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {isGuest ? (
                  <div className="space-y-2">
                    <p>No sample expenses available.</p>
                    <p className="text-xs">Register to create your own budget and track expenses.</p>
                  </div>
                ) : (
                  <>
                    <p>No expenses in the selected period</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-4"
                      disabled={isGuest}
                      onClick={() => { handleActionClick(); if (!isGuest) setShowExpenseDialog(true); }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add your first expense
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {displayExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between py-2.5 transition-colors cursor-pointer hover:bg-accent/50"
                    onClick={() => setViewingExpense(expense)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{expense.description}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full capitalize">
                          {expense.priority}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {safeFormat(expense.expense_date, (d) => formatDistanceToNow(d, { addSuffix: true }))}
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-semibold font-mono tabular-nums shrink-0 text-red-600">
                        {formatSigned(expense.amount, "expense", expense.currency)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Income Form Dialog */}
      <Dialog open={showIncomeForm} onOpenChange={setShowIncomeForm}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add New Income</DialogTitle>
          </DialogHeader>
          <IncomeForm
            onSubmit={handleCreateIncome}
            onCancel={() => setShowIncomeForm(false)}
            isLoading={createIncome.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Income Dialog */}
      <Dialog open={!!editingIncome} onOpenChange={() => setEditingIncome(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Income</DialogTitle>
          </DialogHeader>
          {editingIncome && (
            <IncomeForm
              initialData={{
                id: editingIncome.id,
                amount: editingIncome.amount,
                currency: editingIncome.currency,
                date: editingIncome.date,
                description: editingIncome.description,
                recurring_type: editingIncome.recurring_type,
                start_date: editingIncome.start_date,
                end_date: editingIncome.end_date,
              }}
              onSubmit={handleUpdateIncome}
              onCancel={() => setEditingIncome(null)}
              isLoading={updateIncome.isPending}
            />
          )}
          {editingIncome && (
            <div className="mt-4 pt-4 border-t">
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => handleDeleteIncome(editingIncome)}
                disabled={deleteIncome.isPending}
              >
                Delete Income
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ExpenseDetailDialog
        expense={viewingExpense}
        open={!!viewingExpense}
        onOpenChange={(open) => {
          if (!open) {
            setViewingExpense(null);
          }
        }}
        onEdit={handleEditExpense}
        onDelete={handleDeleteExpense}
        showToast={showToast}
        isGuest={isGuest}
      />

      {/* Expense Form Dialog */}
      <ExpenseFormDialog
        open={showExpenseDialog}
        onOpenChange={setShowExpenseDialog}
        onSubmit={handleCreateExpense}
      />
    </div>
  );
}
