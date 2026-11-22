import { format, subDays } from "date-fns";

// Exchange rates for the comparison page and the Feed's quick popup. Same
// ECB reference rates corefinance fixes records at (corefinance ADR-0003),
// read straight from the browser: frankfurter.dev needs no key and allows
// any origin. Published once per business day, so nothing here is live.
export const RATES_URL = "https://api.frankfurter.dev/v1";

export const DEFAULT_BASE = "PHP";
export const DEFAULT_TARGETS = ["USD", "EUR", "JPY", "GBP", "SGD", "AUD"];
// How far back the trend column looks.
export const TREND_DAYS = 30;

export type CurrencyNames = Record<string, string>;

// A time series as the provider answers it: date → code → units of the
// code per one unit of base.
export interface RateSeries {
  base: string;
  rates: Record<string, Record<string, number>>;
}

export interface ComparisonRow {
  code: string;
  // Units of code per one unit of base, at the latest published date.
  rate: number;
  // Base units per one unit of code: "1 USD = ₱63.78" reads better than
  // "₱1 = $0.0157" when the base is the weaker currency.
  inverse: number;
  converted: number;
  // Percent move of the code against base over the series; positive means
  // one base unit buys more of the code than at the start.
  change: number | null;
  // Rate per published date, oldest first, for the sparkline.
  history: number[];
}

export interface Comparison {
  date: string | null;
  rows: ComparisonRow[];
}

// compareRates turns a series into one row per target, in target order.
// A target the series never mentions is left out rather than shown as 0.
export function compareRates(series: RateSeries, targets: string[], amount: number): Comparison {
  const dates = Object.keys(series.rates).sort();
  const latest = dates.at(-1) ?? null;
  const rows: ComparisonRow[] = [];
  for (const code of targets) {
    if (code === series.base) continue;
    const history = dates
      .map((d) => series.rates[d]?.[code])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    const rate = history.at(-1);
    if (rate === undefined) continue;
    const first = history[0];
    rows.push({
      code,
      rate,
      inverse: 1 / rate,
      converted: Number.isFinite(amount) ? amount * rate : 0,
      change: history.length > 1 ? ((rate - first) / first) * 100 : null,
      history,
    });
  }
  return { date: latest, rows };
}

// parseAmount reads what the owner typed: commas and spaces allowed, empty or
// junk is null so the rows can show a dash instead of NaN.
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// formatMoney shows an amount in its own currency, with enough decimals for
// tiny per-unit rates (₱1 = $0.0157) without padding large ones.
export function formatMoney(value: number, currency: string): string {
  const abs = Math.abs(value);
  const digits = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      minimumFractionDigits: Math.min(digits, 2),
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${RATES_URL}${path}`, { signal });
  if (!res.ok) throw new Error(`Rates request failed (${res.status})`);
  return (await res.json()) as T;
}

export function fetchCurrencies(signal?: AbortSignal): Promise<CurrencyNames> {
  return getJSON<CurrencyNames>("/currencies", signal);
}

// fetchSeries asks for every target over the trend window in one call; its
// last date is the latest published rate.
export function fetchSeries(
  base: string,
  targets: string[],
  today = new Date(),
  signal?: AbortSignal,
): Promise<RateSeries> {
  const from = format(subDays(today, TREND_DAYS), "yyyy-MM-dd");
  const symbols = targets.filter((t) => t !== base).join(",");
  return getJSON<RateSeries>(`/${from}..?base=${base}&symbols=${symbols}`, signal);
}
