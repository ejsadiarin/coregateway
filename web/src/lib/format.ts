/**
 * Central money/number formatting for budget surfaces.
 *
 * Single source of truth: Intl.NumberFormat('en-PH').
 * - formatPeso: grouping + 2 decimals, currency symbol from row (fallback PHP)
 * - formatSigned: +/- prefix for income/expense ledger amounts
 * - formatRate: percentages with 1 decimal
 * - formatCount: plain grouped integers
 *
 * The API sometimes returns amounts as strings (e.g. "100.00"), so every
 * helper coerces via Number() first and renders "—" on NaN.
 */

const pesoCache = new Map<string, Intl.NumberFormat>();
const countFmt = new Intl.NumberFormat("en-PH");

function pesoFormatter(currency: string): Intl.NumberFormat {
  const key = currency || "PHP";
  let fmt = pesoCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: key,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      // Unknown currency code — fall back to PHP symbol with grouped decimals.
      fmt = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    pesoCache.set(key, fmt);
  }
  return fmt;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** e.g. 10000 → "₱10,000.00". Currency taken from the row; falls back to PHP. */
export function formatPeso(value: unknown, currency = "PHP"): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const fmt = pesoFormatter(currency || "PHP");
  const formatted = fmt.format(n);
  // Fallback path (unknown code) has no symbol — prefix manually.
  if (/^[0-9]/.test(formatted.trim())) return `₱${formatted}`;
  return formatted;
}

/** Signed ledger amount: income → "+₱10,000.00", expense → "-₱10,000.00". */
export function formatSigned(
  value: unknown,
  type: "income" | "expense",
  currency = "PHP",
): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const prefix = type === "income" ? "+" : "-";
  return `${prefix}${formatPeso(Math.abs(n), currency)}`;
}

/** e.g. 12.345 → "12.3%". */
export function formatRate(value: unknown, digits = 1): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n.toFixed(digits)}%`;
}

/** e.g. 1234 → "1,234". */
export function formatCount(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return countFmt.format(Math.trunc(n));
}

export type RecurringType =
  | "one-time"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly";

/** True only for actual recurring schedules — "one-time" is NOT recurring. */
export function isRecurringType(
  type: string | null | undefined,
): boolean {
  return (
    type === "daily" ||
    type === "weekly" ||
    type === "monthly" ||
    type === "yearly"
  );
}

/** Human label for any recurring_type value, including "one-time". */
export function getRecurringLabel(
  type: string | null | undefined,
): string {
  switch (type) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "yearly":
      return "Yearly";
    default:
      return "One-time";
  }
}
