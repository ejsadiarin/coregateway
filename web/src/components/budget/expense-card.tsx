
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Edit, Repeat, Calendar } from "lucide-react";
import type { Expense } from "@/types/api";
import { format } from "date-fns";
import { safeFormat } from "@/lib/utils";
import { formatSigned, isRecurringType, getRecurringLabel } from "@/lib/format";

interface ExpenseCardProps {
  expense: Expense;
  onView?: (expense: Expense) => void;
  onEdit?: (expense: Expense) => void;
  onDelete?: (id: string) => void;
  disabled?: boolean;
  showToast?: (message: string, type?: "info" | "warning" | "error" | "success") => void;
}

export function ExpenseCard({ expense, onView, onEdit, onDelete, disabled, showToast }: ExpenseCardProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleCardClick = () => {
    onView?.(expense);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled && showToast) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
      return;
    }
    onEdit?.(expense);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled && showToast) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
      return;
    }
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.(expense.id);
    setDeleteDialogOpen(false);
  };

  const isRecurring = isRecurringType(expense.recurring_type);

  return (
    <>
      <Card
        className="hover:border-primary/50 transition-colors cursor-pointer"
        onClick={handleCardClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="font-semibold">{expense.description}</h3>
                <Badge
                  variant={isRecurring ? "default" : "outline"}
                  className="text-xs"
                >
                  {isRecurring && <Repeat className="h-3 w-3 mr-1" />}
                  {getRecurringLabel(expense.recurring_type)}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {expense.priority}
                </Badge>
              </div>

              {isRecurring && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Calendar className="h-3 w-3" />
                  <span>
                    {expense.start_date && safeFormat(expense.start_date, (d) => format(d, "MMM dd, yyyy"))}
                    {expense.end_date ? (
                      <> - {safeFormat(expense.end_date, (d) => format(d, "MMM dd, yyyy"))}</>
                    ) : (
                      <> - Ongoing</>
                    )}
                  </span>
                </div>
              )}

              {expense.notes && (
                <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{expense.notes}</p>
              )}

              <p className="text-xs text-muted-foreground mt-2">
                {safeFormat(expense.expense_date, (d) => format(d, "MMM dd, yyyy"))}
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="text-xl font-bold font-mono tabular-nums text-red-500">
                {formatSigned(expense.amount, "expense", expense.currency)}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleEditClick}
                  disabled={disabled}
                  className={disabled ? "opacity-50" : ""}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteClick}
                  disabled={disabled}
                  className={disabled ? "opacity-50 text-muted-foreground" : "text-destructive hover:text-destructive"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this expense only if it was added by mistake. This permanently removes it and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
