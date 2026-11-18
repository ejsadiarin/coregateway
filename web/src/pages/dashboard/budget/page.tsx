import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IncomeForm } from "@/components/budget/income-form";
import { EntrySheet } from "@/components/budget/ledger/entry-sheet";
import {
  MoneyOnHandCard,
  BudgetPeriodSelector,
  PeriodBudgetCard,
  WhereItWentCard,
} from "@/components/budget";
import {
  usePeriodBudget,
  useExpenses,
  useIncomes,
  useUpdateIncome,
  useDeleteIncome,
  useUpdateExpense,
  useDeleteExpense,
} from "@/hooks/use-budget";
import {
  budgetDateFrom,
  budgetPeriodBounds,
  budgetPeriodFrom,
  todayISODate,
} from "@/lib/budget-period";
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
import type { BudgetPeriod, Expense, Income, UpdateIncomeRequest, CreateExpenseRequest, UpdateExpenseRequest } from "@/types/api";

export default function BudgetDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // The selected period lives in the URL so it survives a reload and shared
  // links open the same day, week or month.
  const period = budgetPeriodFrom(searchParams.get("period"));
  const anchor = budgetDateFrom(searchParams.get("date"));
  const bounds = budgetPeriodBounds(period, anchor);
  const today = todayISODate();
  const { data: periodBudget, isLoading: periodBudgetLoading } = usePeriodBudget(period, anchor);

  const { data: expensesData, isLoading: expensesLoading } = useExpenses(
    { start_date: bounds.start_date, end_date: bounds.end_date },
    1,
    5
  );

  // recent incomes follow the same selected period; rule entries are incomes
  const { data: incomesData, isLoading: incomesLoading } = useIncomes(
    { start_date: bounds.start_date, end_date: bounds.end_date },
    1,
    10
  );
  const { isGuest } = useAuth();
  const { showToast } = useToast();

  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  // The kind of a new entry being added, in the shared new-entry sheet.
  const [newEntry, setNewEntry] = useState<"expense" | "income" | null>(null);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);

  const selectPeriod = (nextPeriod: BudgetPeriod, nextDate: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("period", nextPeriod);
    params.set("date", nextDate);
    setSearchParams(params);
  };

  // check for query param to open expense dialog (deep linking support)
  useEffect(() => {
    const openExpense = searchParams.get("openExpense");
    if (openExpense === "true") {
      setNewEntry("expense");
      // remove the sheet param but keep the selected period
      const params = new URLSearchParams(searchParams);
      params.delete("openExpense");
      navigate({ pathname: "/dashboard/budget", search: params.toString() }, { replace: true });
    }
  }, [searchParams, navigate]);

  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();

  const displayExpenses = expensesData?.data || [];
  const displayIncomes = incomesData?.data || [];

  const handleActionClick = () => {
    if (isGuest) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
    }
  };

  const handleEditExpense = async (data: CreateExpenseRequest | UpdateExpenseRequest) => {
    if (!viewingExpense) return;
    try {
      await updateExpense.mutateAsync({ id: viewingExpense.id, data });
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
        return;
      }
      // ExpenseForm shows the failure and keeps the form open so the owner
      // can fix it.
      throw error;
    }
    showToast("Expense updated successfully", "success");
    setViewingExpense(null);
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

  const handleUpdateIncome = async (data: UpdateIncomeRequest) => {
    if (!editingIncome) return;
    try {
      await updateIncome.mutateAsync({ id: editingIncome.id, data });
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
        return;
      }
      // IncomeForm shows the failure and keeps the form open so the owner
      // can fix it.
      throw error;
    }
    showToast("Income updated successfully", "success");
    setEditingIncome(null);
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

  return (
    <div className="px-4 md:px-6 py-6">
      {/* Header */}
      <motion.div
        className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="min-w-0">
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
        <div className="flex gap-2 shrink-0">
          <Button
            onClick={() => { handleActionClick(); if (!isGuest) setNewEntry("income"); }}
            disabled={isGuest}
            title={isGuest ? "Guest user is read-only. Create an account to save changes" : undefined}
          >
            <Plus className="h-4 w-4" />
            Add Income
          </Button>
          <Button
            onClick={() => { handleActionClick(); if (!isGuest) setNewEntry("expense"); }}
            disabled={isGuest}
            title={isGuest ? "Guest user is read-only. Create an account to save changes" : undefined}
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </motion.div>

      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <MoneyOnHandCard />
      </motion.div>

      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <BudgetPeriodSelector period={period} date={anchor} onChange={selectPeriod} />
      </motion.div>

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
      >
        <PeriodBudgetCard
          data={periodBudget}
          isLoading={periodBudgetLoading}
          isPast={(periodBudget?.end_date ?? bounds.end_date) < today}
        />
      </motion.div>

      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.15 }}
      >
        <WhereItWentCard period={period} date={anchor} />
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
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {incomesLoading ? (
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
            ) : displayIncomes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No incomes in the selected period</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  disabled={isGuest}
                  title={isGuest ? "Guest user is read-only. Create an account to save changes" : undefined}
                  onClick={() => { handleActionClick(); if (!isGuest) setNewEntry("income"); }}
                >
                  <Plus className="h-4 w-4" />
                  Add your first income
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {displayIncomes.map((income) => {
                  const skipped = income.status === "skipped";
                  return (
                    <div
                      key={income.id}
                      className={`flex items-center justify-between py-2.5 transition-colors cursor-pointer hover:bg-accent/50 ${skipped ? 'bg-red-500/5' : ''}`}
                      onClick={() => setEditingIncome(income)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`flex items-center gap-2 font-medium ${skipped ? 'line-through text-muted-foreground' : ''}`}>
                          <span className="truncate">{income.description || (skipped ? "Skipped Income" : "Income")}</span>
                          {income.source_rule_id && (
                            <Badge variant="secondary" className="text-xs">
                              recurring
                            </Badge>
                          )}
                          {skipped && (
                            <Badge variant="destructive" className="text-xs">
                              Skipped
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {safeFormat(income.date, (d) => formatDistanceToNow(d, { addSuffix: true }))}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className={`font-semibold font-mono tabular-nums shrink-0 ${skipped ? 'text-red-600' : 'text-green-600'}`}>
                          {skipped ? formatPeso(Math.abs(Number(income.amount)), income.currency) : formatSigned(income.amount, "income", income.currency)}
                        </p>
                      </div>
                    </div>
                  );
                })}
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
                <CardDescription>Selected period</CardDescription>
              </div>
              <Link to="/dashboard/budget/expenses">
                <Button variant="ghost" size="sm">
                  View All
                  <ArrowRight className="h-4 w-4" />
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
                      onClick={() => { handleActionClick(); if (!isGuest) setNewEntry("expense"); }}
                    >
                      <Plus className="h-4 w-4" />
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
                category_id: editingIncome.category_id,
                source_rule_id: editingIncome.source_rule_id,
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

      <EntrySheet kind={newEntry ?? "expense"} target={newEntry ? { mode: "new" } : null} onClose={() => setNewEntry(null)} />
    </div>
  );
}
