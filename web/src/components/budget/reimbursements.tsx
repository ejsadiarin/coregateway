import { formatPeso } from "@/lib/format";
import { cn } from "@/lib/utils";

// Reimbursements are money back, not report income.
// https://github.com/ejsadiarin/corefinance/blob/main/docs/adr/0002-system-defined-categories.md
// Show them beside an income figure; vanish when there are none. Amounts
// arrive as decimal strings, so coerce before deciding whether to show.
export function Reimbursements({
  amount,
  className,
}: {
  amount?: number | string;
  className?: string;
}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return (
    <span className={cn("font-mono text-xs text-muted-foreground", className)}>
      Reimbursements{" "}
      <span className="font-medium tabular-nums text-foreground">{formatPeso(value)}</span>
    </span>
  );
}
