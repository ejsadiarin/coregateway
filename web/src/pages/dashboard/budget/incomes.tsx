import { motion } from "motion/react";
import { useState } from "react";
import { useIncomes, useIncomeOccurrences, useDeleteIncome, useUpdateIncome, useCreateIncome, GuestBlockedError } from "@/hooks/use-budget";
import { IncomeCard } from "@/components/budget/income-card";
import { EditIncomeDialog } from "@/components/budget/income-edit-dialog";
import { IncomeForm } from "@/components/budget/income-form";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Filter, ArrowLeft, EyeOff, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Income, IncomeOccurrence, UpdateIncomeRequest, CreateIncomeRequest } from "@/types/api";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import { safeFormat } from "@/lib/utils";
import { formatPeso, formatSigned, getRecurringLabel } from "@/lib/format";
import { Link } from "react-router-dom";

function OccurrenceCard({ occurrence }: { occurrence: IncomeOccurrence }) {
  return (
    <Card className={`${occurrence.is_skipped ? 'opacity-60' : ''} ${occurrence.is_virtual ? 'border-dashed' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className={`font-semibold ${occurrence.is_skipped ? 'line-through text-muted-foreground' : ''}`}>
                {occurrence.description || "Income"}
              </h3>
              {occurrence.is_virtual && (
                <Badge variant="secondary" className="text-xs">
                  <Repeat className="h-3 w-3 mr-1" />
                  {getRecurringLabel(occurrence.recurring_type)}
                </Badge>
              )}
              {occurrence.is_skipped && (
                <Badge variant="destructive" className="text-xs">
                  Skipped
                </Badge>
              )}
              {!occurrence.is_virtual && (
                <Badge variant="outline" className="text-xs">
                  One-time
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {safeFormat(occurrence.date, (d) => format(d, "MMM dd, yyyy"))}
            </p>
          </div>
          <div className={`text-xl font-bold font-mono tabular-nums ${occurrence.is_skipped ? 'text-red-600' : 'text-green-600'}`}>
            {occurrence.is_skipped ? formatPeso(Math.abs(Number(occurrence.amount)), occurrence.currency) : formatSigned(occurrence.amount, "income", occurrence.currency)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface IncomeFilters {
  start_date?: string;
  end_date?: string;
  recurring_type?: string;
}

export default function IncomesPage() {
  const [filters, setFilters] = useState<IncomeFilters>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showOccurrences, setShowOccurrences] = useState(false);

  const hasDateRange = !!(filters.start_date && filters.end_date);

  const { 
    data, 
    isLoading,
  } = useIncomes(filters, page, limit);

  const {
    data: occurrencesData,
    isLoading: occurrencesLoading,
  } = useIncomeOccurrences(
    filters.start_date || '',
    filters.end_date || '',
    page,
    limit,
    hasDateRange && showOccurrences
  );
  const deleteIncome = useDeleteIncome();
  const updateIncome = useUpdateIncome();
  const createIncome = useCreateIncome();
  const { isGuest } = useAuth();
  const { showToast } = useToast();

  const incomes = data?.data ?? [];
  const pagination = data?.pagination;

  // apply client-side search filter
  const filteredIncomes = incomes.filter((income) =>
    (income.description || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClearFilters = () => {
    setFilters({});
    setSearchTerm("");
    setPage(1);
  };

  const hasActiveFilters = !!(filters.recurring_type || filters.start_date || filters.end_date || searchTerm);

  const handleDelete = async (id: string) => {
    try {
      await deleteIncome.mutateAsync(id);
      showToast("Income deleted successfully", "success");
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to delete income", "error");
      }
    }
  };

  const handleUpdate = async (data: UpdateIncomeRequest) => {
    try {
      await updateIncome.mutateAsync({ id: editingIncome!.id, data });
      showToast("Income updated successfully", "success");
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to update income", "error");
      }
    }
  };

  const handleCreate = async (data: CreateIncomeRequest | UpdateIncomeRequest) => {
    try {
      await createIncome.mutateAsync(data as CreateIncomeRequest);
      showToast("Income created successfully", "success");
      setShowCreateDialog(false);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to create income", "error");
      }
    }
  };

  const handleAddClick = () => {
    if (isGuest) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
      return;
    }
    setShowCreateDialog(true);
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
            <h1 className="text-primary">INCOME LIST</h1>
            {isGuest && (
              <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
                Demo Mode
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {isGuest
              ? "Viewing sample incomes"
              : "View and manage all your income sources"}
          </p>
        </div>
        <Button onClick={handleAddClick}>
          <Plus className="mr-2 h-4 w-4" />
          Add Income
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
          <Input
            placeholder="Search incomes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          
          <Select
            value={filters.recurring_type || "all"}
            onValueChange={(value) => {
              setFilters((prev) => ({
                ...prev,
                recurring_type: value === "all" ? undefined : value,
              }));
              setPage(1);
            }}
          >
            <SelectTrigger>
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="daily">Daily Recurring</SelectItem>
              <SelectItem value="weekly">Weekly Recurring</SelectItem>
              <SelectItem value="monthly">Monthly Recurring</SelectItem>
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
                To
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
              Showing {((pagination.page - 1) * pagination.page_size) + 1} to {Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} incomes
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

      {/* Occurrences Toggle */}
      {hasDateRange && (
        <motion.div
          className="mb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/30">
            <Repeat className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground flex-1">
              Date range is set. You can view expanded recurring income occurrences for this period.
            </p>
            <Button
              variant={showOccurrences ? "default" : "outline"}
              size="sm"
              onClick={() => { setShowOccurrences(!showOccurrences); setPage(1); }}
            >
              {showOccurrences ? "Show Records" : "Show Occurrences"}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Income List */}
      <motion.div
        className="space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        {showOccurrences && hasDateRange ? (
          // occurrences view
          occurrencesLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : occurrencesData?.data && occurrencesData.data.length > 0 ? (
            <>
              {occurrencesData.data.map((occ) => (
                <OccurrenceCard key={occ.id} occurrence={occ} />
              ))}
              {occurrencesData.pagination && occurrencesData.pagination.totalPages > 1 && (
                <div className="mt-8 border-t pt-6 flex justify-center">
                  <Pagination
                    currentPage={page}
                    totalPages={occurrencesData.pagination.totalPages}
                    onPageChange={handlePageChange}
                    disabled={occurrencesLoading}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <EyeOff className="w-8 h-8 mx-auto opacity-50" />
              <p className="mt-2">No income occurrences in this date range.</p>
            </div>
          )
        ) : (
          // standard records view
          isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : filteredIncomes && filteredIncomes.length > 0 ? (
          <>
            {filteredIncomes.map((income) => (
              <IncomeCard
                key={income.id}
                income={income}
                onEdit={(inc) => setEditingIncome(inc)}
                onDelete={handleDelete}
                showToast={showToast}
                disabled={isGuest}
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
              <p>No incomes found.</p>
              {isGuest ? (
                <p className="text-xs">Sign in or create an account to manage your own income.</p>
              ) : (
                <Button variant="outline" size="sm" className="mt-2" onClick={handleAddClick}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first income
                </Button>
              )}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Edit Dialog */}
      <EditIncomeDialog
        income={editingIncome}
        open={!!editingIncome}
        onOpenChange={(open) => !open && setEditingIncome(null)}
        onSubmit={handleUpdate}
        isLoading={updateIncome.isPending}
      />

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add New Income</DialogTitle>
          </DialogHeader>
          <IncomeForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createIncome.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
