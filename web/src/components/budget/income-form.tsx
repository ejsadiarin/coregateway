
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateIncomeRequest, UpdateIncomeRequest } from "@/types/api";

interface IncomeFormProps {
  initialData?: UpdateIncomeRequest & { id?: string };
  onSubmit: (data: CreateIncomeRequest | UpdateIncomeRequest) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

export function IncomeForm({ initialData, onSubmit, onCancel, isLoading }: IncomeFormProps) {
  const [formData, setFormData] = useState<CreateIncomeRequest>({
    // corefinance sends amounts as decimal strings ("250.00") but takes numbers.
    amount: Number(initialData?.amount) || 0,
    currency: initialData?.currency || "PHP",
    date: initialData?.date || new Date().toISOString().split('T')[0],
    description: initialData?.description || "",
    // corefinance requires both; the form doesn't ask, so keep what an
    // edited income has, as the expense form does.
    priority: initialData?.priority || "need",
    status: initialData?.status || "posted",
    source_rule_id: initialData?.source_rule_id,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

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

      {/* Date */}
      <div className="space-y-2">
        <Label htmlFor="date">Date *</Label>
        <Input
          id="date"
          type="date"
          required
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
        />
      </div>

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
