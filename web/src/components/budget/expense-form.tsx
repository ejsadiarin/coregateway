
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories } from "@/hooks/use-budget";
import type { CreateExpenseRequest, UpdateExpenseRequest } from "@/types/api";

interface ExpenseFormProps {
  initialData?: UpdateExpenseRequest & { id?: string };
  onSubmit: (data: CreateExpenseRequest | UpdateExpenseRequest) => void | Promise<void>;
  onCancel?: () => void;
}

export function ExpenseForm({ initialData, onSubmit, onCancel }: ExpenseFormProps) {
  const { data: categories } = useCategories();

  const [formData, setFormData] = useState<CreateExpenseRequest>({
    description: initialData?.description || "",
    // corefinance sends amounts as decimal strings ("250.00") but takes numbers.
    amount: Number(initialData?.amount) || 0,
    currency: initialData?.currency || "PHP",
    category_id: initialData?.category_id,
    expense_date: initialData?.expense_date || new Date().toISOString().split('T')[0],
    notes: initialData?.notes,
    recurring_type: initialData?.recurring_type || "one-time",
    priority: initialData?.priority || "need",
    status: initialData?.status || "posted",
    is_debt: initialData?.is_debt || false,
    start_date: initialData?.start_date || undefined,
    end_date: initialData?.end_date || undefined,
  });

  const [noEndDate, setNoEndDate] = useState(!initialData?.end_date);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

  const isRecurring = formData.recurring_type !== "one-time";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description *</Label>
        <Input
          id="description"
          required
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="e.g., Groceries at Whole Foods"
        />
      </div>

      {/* Amount and Currency */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount *</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            required
            value={formData.amount || ""}
            onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            maxLength={3}
            value={formData.currency}
            onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
            placeholder="PHP"
          />
        </div>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Select
          value={formData.category_id || "none"}
          onValueChange={(value) =>
            setFormData({ ...formData, category_id: value === "none" ? undefined : value })
          }
        >
          <SelectTrigger id="category">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {categories?.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.icon && <span className="mr-2">{category.icon}</span>}
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <Select
          value={formData.priority}
          onValueChange={(value) =>
            setFormData({ ...formData, priority: value as "need" | "want" | "savings" })
          }
        >
          <SelectTrigger id="priority">
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="need">Need</SelectItem>
            <SelectItem value="want">Want</SelectItem>
            <SelectItem value="savings">Savings</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Recurring Type */}
      <div className="space-y-2">
        <Label htmlFor="recurring_type">Type</Label>
        <Select
          value={formData.recurring_type}
          onValueChange={(value) =>
            setFormData({
              ...formData,
              recurring_type: value as "one-time" | "daily" | "weekly" | "monthly" | "yearly",
              start_date: value !== "one-time" ? formData.expense_date : undefined,
              end_date: value !== "one-time" ? formData.end_date : undefined,
            })
          }
        >
          <SelectTrigger id="recurring_type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one-time">One-time</SelectItem>
            <SelectItem value="daily">Daily Recurring</SelectItem>
            <SelectItem value="weekly">Weekly Recurring</SelectItem>
            <SelectItem value="monthly">Monthly Recurring</SelectItem>
            <SelectItem value="yearly">Yearly Recurring</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Date for one-time, Start Date for recurring */}
      <div className="space-y-2">
        <Label htmlFor="expense_date">{isRecurring ? "Start Date *" : "Date *"}</Label>
        <Input
          id="expense_date"
          type="date"
          required
          value={formData.expense_date}
          onChange={(e) => {
            const newDate = e.target.value;
            setFormData({
              ...formData,
              expense_date: newDate,
              start_date: isRecurring ? newDate : formData.start_date,
            });
          }}
        />
      </div>

      {/* End Date for recurring expenses */}
      {isRecurring && (
        <>
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="no_end_date"
              checked={noEndDate}
              onChange={(e) => {
                setNoEndDate(e.target.checked);
                if (e.target.checked) {
                  setFormData({ ...formData, end_date: undefined });
                }
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="no_end_date" className="font-normal cursor-pointer">
              No end date (ongoing)
            </Label>
          </div>

          {!noEndDate && (
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.end_date || ""}
                min={formData.start_date || formData.expense_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value || undefined })}
              />
              {formData.end_date && formData.start_date && formData.end_date < formData.start_date && (
                <p className="text-sm text-red-600">End date must be on or after start date</p>
              )}
            </div>
          )}

          {initialData?.end_date === undefined && noEndDate && (
            <div className="text-sm text-muted-foreground bg-blue-50 border border-blue-200 rounded px-3 py-2">
              <span className="font-medium">Ongoing</span> - This expense will continue indefinitely
            </div>
          )}
        </>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes || ""}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes about this expense..."
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit">
          {initialData?.id ? "Update" : "Create"} Expense
        </Button>
      </div>
    </form>
  );
}
