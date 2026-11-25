import { format, subDays } from "date-fns";

// Exchange rates for the comparison page and the Feed's quick popup. Same
// ECB reference rates corefinance fixes records at (corefinance ADR-0003),
// read straight from the browser: frankfurter.dev needs no key and allows
// any origin. Published once per business day, so nothing here is live.
export const RATES_URL = "https://api.frankfurter.dev/v1";

export const DEFAULT_BASE = "PHP";
// Pinned currencies come first in every list and are always compared. These
// are the owner's everyday ones, until pins are changed on the page.
export const DEFAULT_PINNED = ["PHP", "USD", "JPY", "KRW", "GBP"];
export const DEFAULT_TARGETS = ["EUR", "SGD", "AUD"];
// How far back the trend column looks.
export const TREND_DAYS = 30;

// How long fetched rates count as fresh. ECB publishes about 16:00 CET on
// business days, so an hourly check is at most an hour behind it.
export const FRESH_MS = 1000 * 60 * 60;

// A time series as the provider answers it: date → code → units of the
// code per one unit of base. Every currency is in it, so any pair is a cross
// rate away and one saved series answers the whole page offline.
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

// crossRate is units of code per one unit of base on one date, through the
// series' own base; null when either side was not published.
function crossRate(series: RateSeries, date: string, base: string, code: string): number | null {
  const per = (c: string) => (c === series.base ? 1 : series.rates[date]?.[c]);
  const from = per(base);
  const to = per(code);
  if (!from || !to) return null;
  const rate = to / from;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

// compareRates turns a series into one row per target, in target order.
// A target the series never mentions is left out rather than shown as 0.
export function compareRates(series: RateSeries, base: string, targets: string[], amount: number): Comparison {
  const dates = Object.keys(series.rates).sort();
  const latest = dates.at(-1) ?? null;
  const rows: ComparisonRow[] = [];
  for (const code of targets) {
    if (code === base) continue;
    const history = dates.map((d) => crossRate(series, d, base, code)).filter((v) => v !== null);
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

// groupCodes splits codes into the pinned ones, in pinned order, and the
// rest, in the order given.
export function groupCodes(codes: string[], pins: string[]): { pinned: string[]; others: string[] } {
  return {
    pinned: pins.filter((c) => codes.includes(c)),
    others: codes.filter((c) => !pins.includes(c)),
  };
}

// togglePin pins a compared currency, last, or unpins it, which leaves it
// compared at the top of the others rather than dropping it.
export function togglePin<T extends { pinned: string[]; targets: string[] }>(setup: T, code: string): T {
  const targets = setup.targets.filter((t) => t !== code);
  return setup.pinned.includes(code)
    ? { ...setup, pinned: setup.pinned.filter((p) => p !== code), targets: [code, ...targets] }
    : { ...setup, pinned: [...setup.pinned, code], targets };
}

// seriesCodes lists every currency the series can convert, alphabetically.
export function seriesCodes(series: RateSeries): string[] {
  const codes = new Set([series.base]);
  for (const day of Object.values(series.rates)) for (const c of Object.keys(day)) codes.add(c);
  return [...codes].sort();
}

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames("en", { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
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

// fetchSeries asks for every currency over the trend window in one call; its
// last date is the latest published rate. The provider lets browsers reuse an
// answer for a day, which would hide a new rate, so each call revalidates
// (an unchanged answer is a 304).
export async function fetchSeries(today = new Date(), signal?: AbortSignal): Promise<RateSeries> {
  const from = format(subDays(today, TREND_DAYS), "yyyy-MM-dd");
  const res = await fetch(`${RATES_URL}/${from}..`, { signal, cache: "no-cache" });
  if (!res.ok) throw new Error(`Rates request failed (${res.status})`);
  return (await res.json()) as RateSeries;
}

// The last series fetched on this device, kept until a newer one replaces it
// so the comparison works offline however long that lasts.
const SAVED_KEY = "core-exchange-rates";

export interface SavedRates {
  fetchedAt: number;
  series: RateSeries;
}

export function saveRates(series: RateSeries, now = Date.now()) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ fetchedAt: now, series } satisfies SavedRates));
  } catch {
    // Storage blocked or full: rates last for this visit only.
  }
}

// parseSavedRates reads a saved copy back; anything malformed is no copy.
export function parseSavedRates(raw: string | null): SavedRates | undefined {
  if (!raw) return undefined;
  try {
    const s = JSON.parse(raw) as SavedRates | null;
    if (typeof s?.fetchedAt !== "number" || typeof s.series?.base !== "string") return undefined;
    const days = s.series.rates && typeof s.series.rates === "object" ? Object.values(s.series.rates) : [];
    if (days.length === 0 || days.some((d) => !d || typeof d !== "object")) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

export function loadRates(): SavedRates | undefined {
  try {
    return parseSavedRates(localStorage.getItem(SAVED_KEY));
  } catch {
    return undefined;
  }
}
