import { formatPeso, type CurrencyTotal } from "@/lib/format";
import { cn } from "@/lib/utils";

// CurrencyAmounts shows one amount per currency, stacked when a projection
// spans more than one. A single-currency set looks exactly like one amount.
export function CurrencyAmounts({
  totals,
  className,
  format = formatPeso,
  tone,
}: {
  totals: CurrencyTotal[];
  className?: string;
  format?: (amount: number, currency: string) => string;
  tone?: (total: CurrencyTotal) => string | undefined;
}) {
  if (!totals.length) return <div className={className}>—</div>;
  return (
    <div className={cn("flex flex-col", className)}>
      {totals.map((total) => (
        <span key={total.currency} className={tone?.(total)}>
          {format(total.amount, total.currency)}
        </span>
      ))}
    </div>
  );
}
