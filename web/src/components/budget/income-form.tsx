
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CreateIncomeRequest, UpdateIncomeRequest } from "@/types/api";

interface IncomeFormProps {
  initialData?: UpdateIncomeRequest & { id?: string };
  onSubmit: (data: CreateIncomeRequest | UpdateIncomeRequest) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export function IncomeForm({ initialData, onSubmit, onCancel, isLoading }: IncomeFormProps) {
  const [formData, setFormData] = useState<CreateIncomeRequest>({
    amount: initialData?.amount || 0,
    currency: initialData?.currency || "PHP",
    date: initialData?.date || new Date().toISOString().split('T')[0],
    description: initialData?.description || "",
    recurring_type: initialData?.recurring_type || "one-time",
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

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description || ""}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="e.g., Salary, Allowance, etc."
        />
      </div>

      {/* Recurring Type */}
      <div className="space-y-2">
        <Label htmlFor="recurring_type">Type</Label>
        <Select
          value={formData.recurring_type || "one-time"}
          onValueChange={(value) =>
            setFormData({
              ...formData,
              recurring_type: value as "one-time" | "daily" | "weekly" | "monthly" | "yearly",
              start_date: value !== "one-time" ? formData.date : undefined,
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
          </SelectContent>
        </Select>
      </div>

      {/* Date for one-time, Start Date for recurring */}
      <div className="space-y-2">
        <Label htmlFor="date">{isRecurring ? "Start Date *" : "Date *"}</Label>
        <Input
          id="date"
          type="date"
          required
          value={formData.date}
          onChange={(e) => {
            const newDate = e.target.value;
            setFormData({
              ...formData,
              date: newDate,
              start_date: isRecurring ? newDate : formData.start_date,
            });
          }}
        />
      </div>

      {/* End Date for recurring income */}
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
                min={formData.start_date || formData.date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value || undefined })}
              />
              {formData.end_date && formData.start_date && formData.end_date < formData.start_date && (
                <p className="text-sm text-red-600">End date must be after start date</p>
              )}
            </div>
          )}

          {initialData?.end_date === undefined && noEndDate && (
            <div className="text-sm text-muted-foreground bg-blue-50 border border-blue-200 rounded px-3 py-2">
              <span className="font-medium">Ongoing</span> - This income will continue indefinitely
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={isLoading} className="flex-1">
          {isLoading ? "Saving..." : initialData?.id ? "Update Income" : "Add Income"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
