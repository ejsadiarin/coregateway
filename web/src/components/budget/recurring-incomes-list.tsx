
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
import { useRecurringIncomes, useIncome, useUpdateIncome, GuestBlockedError } from '@/hooks/use-budget';
import { Calendar, Clock, MoreVertical, Pencil, SkipForward, XCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { safeFormat } from '@/lib/utils';
import { formatSigned, formatCount } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { EditIncomeDialog } from './income-edit-dialog';
import { SkipOccurrenceDialog } from './skip-occurrence-dialog';
import { CancelRecurringDialog } from './cancel-recurring-dialog';
import type { RecurringIncomeWithNextDate, UpdateIncomeRequest } from '@/types/api';

interface RecurringIncomesListProps {
  className?: string;
}

export function RecurringIncomesList({ className }: RecurringIncomesListProps) {
  const { data: recurringIncomes, isLoading } = useRecurringIncomes();
  const { showToast } = useToast();
  const updateIncome = useUpdateIncome();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [skippingIncome, setSkippingIncome] = useState<RecurringIncomeWithNextDate | null>(null);
  const [cancellingIncome, setCancellingIncome] = useState<RecurringIncomeWithNextDate | null>(null);

  const { data: fullIncome } = useIncome(editingId);

  const handleEditSubmit = async (data: UpdateIncomeRequest) => {
    if (!editingId) return;
    try {
      await updateIncome.mutateAsync({ id: editingId, data });
      showToast('Income updated', 'success');
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, 'warning');
      } else {
        showToast('Failed to update income', 'error');
      }
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recurring Incomes</CardTitle>
          <CardDescription className="text-xs">Your regular income sources</CardDescription>
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

  if (!recurringIncomes || recurringIncomes.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recurring Incomes</CardTitle>
          <CardDescription className="text-xs">Your regular income sources</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No recurring incomes yet</p>
            <p className="text-xs mt-1">Add recurring income to track expected earnings</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium text-muted-foreground">Recurring Incomes</CardTitle>
              <CardDescription className="text-xs">Your regular income sources</CardDescription>
            </div>
            <Badge variant="secondary">{recurringIncomes.length} sources</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recurringIncomes.map((income) => (
              <div
                key={income.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-border transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{income.description || 'Income'}</p>
                    {income.recurring_type && (
                      <Badge variant="outline" className="text-xs">
                        {income.recurring_type}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    <span>Starts: {safeFormat(income.start_date, (d) => format(d, 'MMM d, yyyy'))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="font-semibold font-mono tabular-nums text-green-600">
                      {formatSigned(income.amount, "income", income.currency)}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingId(income.id)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSkippingIncome(income)}>
                        <SkipForward className="h-4 w-4 mr-2" />
                        Skip Occurrence
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setCancellingIncome(income)}
                        className="text-destructive focus:text-destructive"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Cancel Recurring
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <EditIncomeDialog
        income={fullIncome ?? null}
        open={!!editingId && !!fullIncome}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
        onSubmit={handleEditSubmit}
        isLoading={updateIncome.isPending}
      />

      <SkipOccurrenceDialog
        income={skippingIncome}
        open={!!skippingIncome}
        onOpenChange={(open) => {
          if (!open) setSkippingIncome(null);
        }}
      />

      <CancelRecurringDialog
        item={cancellingIncome ? {
          id: cancellingIncome.id,
          description: cancellingIncome.description || 'Income',
          amount: cancellingIncome.amount,
          currency: cancellingIncome.currency,
          recurring_type: cancellingIncome.recurring_type || 'N/A'
        } : null}
        itemType="income"
        open={!!cancellingIncome}
        onOpenChange={(open) => {
          if (!open) setCancellingIncome(null);
        }}
      />
    </>
  );
}
