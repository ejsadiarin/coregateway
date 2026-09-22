
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useSubscriptions, useExpense, useUpdateExpense, GuestBlockedError } from '@/hooks/use-budget';
import { RefreshCw, Calendar, MoreVertical, Pencil, SkipForward, XCircle } from 'lucide-react';
import { cn, safeFormat } from '@/lib/utils';
import { formatPeso, formatCount } from '@/lib/format';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/components/ui/toast';
import { EditExpenseDialog } from './expense-edit-dialog';
import { SkipExpenseDialog } from './skip-expense-dialog';
import { CancelRecurringDialog } from './cancel-recurring-dialog';
import type { SubscriptionItem, UpdateExpenseRequest } from '@/types/api';

interface RecurringExpensesListProps {
  className?: string;
}

export function RecurringExpensesList({ className }: RecurringExpensesListProps) {
  const { data, isLoading, error } = useSubscriptions();
  const { showToast } = useToast();
  const updateExpense = useUpdateExpense();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [skippingExpense, setSkippingExpense] = useState<SubscriptionItem | null>(null);
  const [cancellingExpense, setCancellingExpense] = useState<SubscriptionItem | null>(null);

  const { data: fullExpense } = useExpense(editingId);

  const handleEditSubmit = async (data: UpdateExpenseRequest) => {
    if (!editingId) return;
    try {
      await updateExpense.mutateAsync({ id: editingId, data });
      showToast('Expense updated', 'success');
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, 'warning');
      } else {
        showToast('Failed to update expense', 'error');
      }
    }
  };

  const getRecurringBadge = (type: string) => {
    switch (type) {
      case 'monthly':
        return { label: 'Monthly', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' };
      case 'yearly':
        return { label: 'Yearly', color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' };
      case 'weekly':
        return { label: 'Weekly', color: 'bg-green-500/10 text-green-500 border-green-500/20' };
      case 'daily':
        return { label: 'Daily', color: 'bg-orange-500/10 text-orange-500 border-orange-500/20' };
      default:
        return { label: type, color: 'bg-muted text-muted-foreground' };
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recurring Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 animate-pulse">
                <div className="h-10 w-10 bg-muted rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/2 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recurring Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load recurring expenses</div>
        </CardContent>
      </Card>
    );
  }

  const subscriptions = data.subscriptions || [];

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground">Recurring Expenses</CardTitle>
              <CardDescription className="text-xs">
                {formatCount(data.count)} active · {formatPeso(data.total_monthly)}/mo
              </CardDescription>
            </div>
            <Badge variant="secondary">{data.count} active</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No recurring expenses found
            </div>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => {
                const badge = getRecurringBadge(sub.recurring_type);
                return (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between p-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-muted">
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{sub.description}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Next: {safeFormat(sub.next_due_date, (d) => format(d, 'MMM d, yyyy'))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="text-sm font-medium font-mono tabular-nums">
                          {formatPeso(sub.amount, sub.currency)}
                        </div>
                        <Badge variant="outline" className={cn('text-xs mt-1', badge.color)}>
                          {badge.label}
                        </Badge>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingId(sub.id)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSkippingExpense(sub)}>
                            <SkipForward className="h-4 w-4 mr-2" />
                            Skip Occurrence
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setCancellingExpense(sub)}
                            className="text-destructive focus:text-destructive"
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            Cancel Recurring
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <EditExpenseDialog
        expense={fullExpense ?? null}
        open={!!editingId && !!fullExpense}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
        onSubmit={handleEditSubmit}
      />

      <SkipExpenseDialog
        expense={skippingExpense}
        open={!!skippingExpense}
        onOpenChange={(open) => {
          if (!open) setSkippingExpense(null);
        }}
      />

      <CancelRecurringDialog
        item={cancellingExpense}
        itemType="expense"
        open={!!cancellingExpense}
        onOpenChange={(open) => {
          if (!open) setCancellingExpense(null);
        }}
      />
    </>
  );
}
