
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import { Edit, Trash2, Calendar, Repeat } from "lucide-react";
import type { Expense } from "@/types/api";
import { format } from "date-fns";
import { safeFormat } from "@/lib/utils";
import { formatSigned, isRecurringType, getRecurringLabel } from "@/lib/format";
import { EditExpenseDialog } from "./expense-edit-dialog";

interface ExpenseDetailDialogProps {
  expense: Expense | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (data: any) => void | Promise<void>;
  onDelete?: (id: string) => void;
  showToast?: (message: string, type?: "info" | "warning" | "error" | "success") => void;
  isGuest?: boolean;
}

export function ExpenseDetailDialog({
  expense,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  showToast,
  isGuest = false,
}: ExpenseDetailDialogProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (!expense) return null;

  const isRecurring = isRecurringType(expense.recurring_type);

  const handleEditClick = () => {
    if (isGuest && showToast) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
      return;
    }
    setEditDialogOpen(true);
  };

  const handleDeleteClick = () => {
    if (isGuest && showToast) {
      showToast("Guest user is read-only. Create an account to save changes", "warning");
      return;
    }
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.(expense.id);
    onOpenChange(false);
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Expense Details</DialogTitle>
            <DialogDescription>
              View the full details of this expense.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 mt-2">
            {/* Priority & Recurring */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-sm capitalize">
                {expense.priority}
              </Badge>
              <Badge
                variant={isRecurring ? "default" : "outline"}
                className="text-sm"
              >
                {isRecurring && <Repeat className="h-3 w-3 mr-1" />}
                {getRecurringLabel(expense.recurring_type)}
              </Badge>
            </div>

            {/* Title + Price row */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-6">
              <h3 
                className="text-lg font-semibold leading-tight break-words min-w-0 flex-1"
                style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
              >
                {expense.description}
              </h3>
              <p className="text-2xl font-bold font-mono tabular-nums text-primary shrink-0">
                {formatSigned(expense.amount, "expense", expense.currency)}
              </p>
            </div>

            {/* Notes */}
            {expense.notes && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p 
                  className="text-sm text-muted-foreground"
                  style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
                >
                  {expense.notes}
                </p>
              </div>
            )}

            {/* Date */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>
                {isRecurring ? (
                  <>
                    {safeFormat(expense.start_date, (d) => format(d, "MMMM dd, yyyy"))}
                    {expense.end_date ? (
                      <> - {safeFormat(expense.end_date, (d) => format(d, "MMMM dd, yyyy"))}</>
                    ) : (
                      <> - Ongoing</>
                    )}
                  </>
                ) : (
                  safeFormat(expense.expense_date, (d) => format(d, "MMMM dd, yyyy"))
                )}
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleEditClick}
                className="flex-1"
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={handleDeleteClick}
                className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <EditExpenseDialog
        expense={expense}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSubmit={async (data) => {
          if (onEdit) {
            await onEdit(data);
          }
          setEditDialogOpen(false);
          onOpenChange(false);
        }}
      />

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
