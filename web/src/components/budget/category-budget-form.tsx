
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { useCreateCategoryBudget, useUpdateCategoryBudget, useCategories } from '@/hooks/use-budget';
import type { CategoryBudgetWithVariance } from '@/types/api';
import { formatPeso } from '@/lib/format';
import { format } from 'date-fns';
import { DollarSign, Edit2, Plus } from 'lucide-react';

interface CategoryBudgetFormProps {
  categoryBudget?: CategoryBudgetWithVariance;
  categoryId?: string;
  month?: string;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function CategoryBudgetForm({
  categoryBudget,
  categoryId,
  month,
  onSuccess,
  trigger
}: CategoryBudgetFormProps) {
  const [open, setOpen] = useState(false);
  const [budgetAmount, setBudgetAmount] = useState(
    categoryBudget?.budget_amount?.toString() || ''
  );

  const { data: categories } = useCategories();
  const createBudget = useCreateCategoryBudget();
  const updateBudget = useUpdateCategoryBudget();

  const isEditing = !!categoryBudget;
  const currentMonth = month || format(new Date(), 'yyyy-MM-dd');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amount = parseFloat(budgetAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      if (isEditing && categoryBudget) {
        await updateBudget.mutateAsync({
          id: categoryBudget.category_id,
          data: { budget_amount: amount }
        });
      } else if (categoryId) {
        await createBudget.mutateAsync({
          category_id: categoryId,
          month: currentMonth,
          budget_amount: amount
        });
      }

      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error('Failed to save budget:', error);
    }
  };

  const selectedCategory = categories?.find(c => c.id === categoryId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            {isEditing ? (
              <>
                <Edit2 className="h-4 w-4 mr-1" />
                Edit Budget
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" />
                Set Budget
              </>
            )}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit Budget' : 'Set Category Budget'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? `Update budget for ${categoryBudget?.category_name}`
                : selectedCategory
                ? `Set monthly budget for ${selectedCategory.name}`
                : 'Set monthly budget for this category'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="month">Month</Label>
              <Input
                id="month"
                value={format(new Date(currentMonth), 'MMMM yyyy')}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="budget">Budget Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="budget"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>

            {categoryBudget && categoryBudget.spent_amount > 0 && (
              <div className="text-sm text-muted-foreground">
                Current spending: {formatPeso(categoryBudget.spent_amount)}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !budgetAmount ||
                parseFloat(budgetAmount) <= 0 ||
                createBudget.isPending ||
                updateBudget.isPending
              }
            >
              {createBudget.isPending || updateBudget.isPending
                ? 'Saving...'
                : isEditing
                ? 'Update Budget'
                : 'Set Budget'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
