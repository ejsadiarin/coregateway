import { format, isValid, parseISO } from "date-fns";
import { formatPeso } from "./format";
import type { Entry } from "./ledger";

// conversionLabel is the fixed conversion a non-PHP entry shows: the original
// amount, its PHP amount, the rate and the rate's published date. PHP entries
// have nothing to explain.
export function conversionLabel(
  entry: Pick<Entry, "currency" | "amount" | "conversion">,
): string | undefined {
  if (entry.currency === "PHP" || !entry.conversion) {
    return undefined;
  }
  const { amountPHP, exchangeRate, rateDate } = entry.conversion;
  const date = parseISO(rateDate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || !isValid(date)) {
    return undefined;
  }
  return `${formatPeso(entry.amount, entry.currency)} · ${formatPeso(amountPHP)} at ${exchangeRate} (${format(date, "MMM d")})`;
}
