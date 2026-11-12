
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IncomeForm } from "./income-form";
import type { Income, UpdateIncomeRequest } from "@/types/api";

interface EditIncomeDialogProps {
  income: Income | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: UpdateIncomeRequest) => Promise<void>;
  isLoading?: boolean;
}

export function EditIncomeDialog({
  income,
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: EditIncomeDialogProps) {
  if (!income) return null;

  const handleSubmit = async (data: UpdateIncomeRequest) => {
    await onSubmit(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Income</DialogTitle>
        </DialogHeader>
        <IncomeForm
          initialData={{
            id: income.id,
            amount: income.amount,
            currency: income.currency,
            date: income.date,
            description: income.description,
            recurring_type: income.recurring_type,
            priority: income.priority,
            status: income.status,
            start_date: income.start_date,
            end_date: income.end_date,
          }}
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
