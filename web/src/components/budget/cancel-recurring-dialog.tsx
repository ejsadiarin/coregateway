
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { XCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { GuestBlockedError } from '@/hooks/use-budget';
import { budgetKeys } from '@/hooks/use-budget';
import { cancelRecurringExpense, cancelRecurringIncome } from '@/lib/api';
import { formatPeso } from '@/lib/format';
import { useAuth } from '@/contexts/auth-context';

type RecurringItemType = 'expense' | 'income';

interface CancelRecurringItem {
  id: string;
  description: string;
  amount: number;
  currency: string;
  recurring_type: string;
}

interface CancelRecurringDialogProps {
  item: CancelRecurringItem | null;
  itemType: RecurringItemType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelRecurringDialog({ item, itemType, open, onOpenChange }: CancelRecurringDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { isGuest } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCancel = async () => {
    if (!item) return;

    if (isGuest) {
      showToast(new GuestBlockedError().message, 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      if (itemType === 'expense') {
        await cancelRecurringExpense(item.id);
      } else {
        await cancelRecurringIncome(item.id);
      }

      // invalidate relevant caches
      if (itemType === 'expense') {
        queryClient.invalidateQueries({ queryKey: budgetKeys.subscriptions() });
        queryClient.invalidateQueries({ queryKey: budgetKeys.expenses() });
      } else {
        queryClient.invalidateQueries({ queryKey: budgetKeys.recurringIncomes() });
        queryClient.invalidateQueries({ queryKey: budgetKeys.incomes() });
      }
      queryClient.invalidateQueries({ queryKey: budgetKeys.stats() });

      showToast(
        `Cancelled recurring ${itemType}: ${item.description || itemType}`,
        'success'
      );
      onOpenChange(false);
    } catch (error) {
      console.error('Error cancelling recurring item:', error);
      showToast(`Failed to cancel recurring ${itemType}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!item) return null;

  const typeLabel = itemType === 'expense' ? 'Expense' : 'Income';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5" />
            Cancel Recurring {typeLabel}
          </DialogTitle>
          <DialogDescription>
            This will set the end date to today. Future occurrences will no longer appear.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-4 rounded-lg bg-muted space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Description</span>
              <span className="font-medium">{item.description || typeLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium font-mono tabular-nums">
                {formatPeso(item.amount, item.currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Frequency</span>
              <span className="font-medium capitalize">{item.recurring_type || 'N/A'}</span>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-xs">
              This action sets the end date to today. The {itemType} history will be preserved, but no future
              occurrences will be generated. You can reactivate it later by editing the end date.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep Active
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Cancelling...' : `Cancel ${typeLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
