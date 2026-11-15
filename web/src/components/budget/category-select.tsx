import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Category } from "@/types/api";

export function CategorySelect({
  id = "category",
  categories,
  value,
  onChange,
}: {
  id?: string;
  categories?: Category[];
  value?: string;
  onChange: (id: string | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Category</Label>
      <Select
        value={value || "none"}
        onValueChange={(next) => onChange(next === "none" ? undefined : next)}
      >
        <SelectTrigger id={id}>
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
  );
}
