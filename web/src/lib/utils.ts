import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safe date formatter that returns a fallback string instead of throwing
 * on invalid dates (prevents RangeError: Invalid time value crashes).
 */
export function safeFormat(
  dateValue: string | Date | null | undefined,
  formatter: (d: Date) => string,
  fallback = '—'
): string {
  if (!dateValue) return fallback;
  try {
    const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (isNaN(d.getTime())) return fallback;
    return formatter(d);
  } catch {
    return fallback;
  }
}
