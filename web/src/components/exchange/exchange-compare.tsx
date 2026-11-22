import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpDown, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  DEFAULT_BASE,
  DEFAULT_TARGETS,
  TREND_DAYS,
  compareRates,
  fetchCurrencies,
  fetchSeries,
  formatMoney,
  parseAmount,
} from "@/lib/exchange";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The page and the Feed popup share one remembered setup, so a currency added
// in either shows in both. Per-viewer convenience only: storage can be
// missing (private window) and the defaults stand in.
const STORAGE_KEY = "core-exchange";

interface Setup {
  base: string;
  targets: string[];
  amount: string;
}

function loadSetup(): Setup {
  const fallback = { base: DEFAULT_BASE, targets: DEFAULT_TARGETS, amount: "1000" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Setup>;
    return {
      base: typeof s.base === "string" ? s.base : fallback.base,
      targets: Array.isArray(s.targets) ? s.targets.filter((t) => typeof t === "string") : fallback.targets,
      amount: typeof s.amount === "string" ? s.amount : fallback.amount,
    };
  } catch {
    return fallback;
  }
}

function saveSetup(setup: Setup) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Storage blocked: the setup lasts for this visit only.
  }
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="inline-block h-6 w-16" aria-hidden />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${((i / (points.length - 1)) * 64).toFixed(1)},${(22 - ((p - min) / span) * 20).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0 text-primary" aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function ExchangeCompare({ compact = false }: { compact?: boolean }) {
  const [setup, setSetup] = useState<Setup>(loadSetup);
  useEffect(() => saveSetup(setup), [setup]);
  const { base, targets, amount } = setup;
  const value = parseAmount(amount);

  const currencies = useQuery({
    queryKey: ["exchange", "currencies"],
    queryFn: ({ signal }) => fetchCurrencies(signal),
    staleTime: 1000 * 60 * 60 * 24,
  });

  const series = useQuery({
    queryKey: ["exchange", "series", base, [...targets].sort().join(",")],
    queryFn: ({ signal }) => fetchSeries(base, targets, new Date(), signal),
    enabled: targets.some((t) => t !== base),
    // ECB publishes once per business day; an hour is plenty fresh.
    staleTime: 1000 * 60 * 60,
  });

  const comparison = useMemo(
    () => (series.data ? compareRates(series.data, targets, value ?? 0) : null),
    [series.data, targets, value],
  );

  const codes = useMemo(() => Object.keys(currencies.data ?? {}).sort(), [currencies.data]);
  const addable = codes.filter((c) => c !== base && !targets.includes(c));
  const name = (code: string) => currencies.data?.[code] ?? code;

  const setBase = (next: string) =>
    setSetup((s) => ({
      ...s,
      base: next,
      // The old base becomes a target so swapping back is one tap.
      targets: [...(s.targets.includes(s.base) ? [] : [s.base]), ...s.targets.filter((t) => t !== next)],
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor={compact ? "fx-amount-quick" : "fx-amount"}>Amount</Label>
          <Input
            id={compact ? "fx-amount-quick" : "fx-amount"}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setSetup((s) => ({ ...s, amount: e.target.value }))}
            className="min-h-11 font-mono text-base"
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label>From</Label>
          <Select value={base} onValueChange={setBase}>
            <SelectTrigger className="min-h-11 font-mono" aria-label="Base currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {(codes.length ? codes : [base]).map((c) => (
                <SelectItem key={c} value={c} className="font-mono">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {series.isError && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
          Couldn't load exchange rates.
          <Button variant="ghost" size="sm" onClick={() => series.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </Button>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border" aria-busy={series.isLoading}>
        {series.isLoading &&
          targets.map((t) => (
            <li key={t} className="flex h-16 items-center px-3">
              <div className="h-4 w-full animate-pulse rounded bg-muted/40" />
            </li>
          ))}
        {comparison?.rows.map((row) => (
          <li key={row.code} className="flex items-center gap-3 px-3 py-2.5">
            <button
              type="button"
              onClick={() => setBase(row.code)}
              className="flex min-h-11 w-14 shrink-0 flex-col items-start justify-center font-mono text-sm font-semibold hover:text-primary"
              title={`Convert from ${row.code}`}
            >
              {row.code}
              <ArrowUpDown className="h-3 w-3 text-muted-foreground" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-base tabular-nums">
                {value === null ? "—" : formatMoney(row.converted, row.code)}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                1 {row.code} = {formatMoney(row.inverse, base)}
                {!compact && <span className="hidden sm:inline"> · {name(row.code)}</span>}
              </div>
            </div>
            {!compact && <Sparkline points={row.history} />}
            {row.change !== null && (
              <span
                className={cn(
                  "flex w-16 shrink-0 items-center justify-end gap-0.5 font-mono text-xs tabular-nums",
                  row.change >= 0 ? "text-primary" : "text-muted-foreground",
                )}
                title={`${base} vs ${row.code} over ${TREND_DAYS} days`}
              >
                {row.change >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3 w-3" aria-hidden />
                )}
                {Math.abs(row.change).toFixed(2)}%
              </span>
            )}
            <button
              type="button"
              onClick={() => setSetup((s) => ({ ...s, targets: s.targets.filter((t) => t !== row.code) }))}
              className="flex h-11 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${row.code}`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
        {!series.isLoading && targets.filter((t) => t !== base).length === 0 && (
          <li className="px-3 py-4 text-sm text-muted-foreground">Add a currency to compare.</li>
        )}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value=""
          onValueChange={(code) => setSetup((s) => ({ ...s, targets: [...s.targets, code] }))}
          disabled={addable.length === 0}
        >
          <SelectTrigger className="min-h-11 w-44" aria-label="Add currency">
            <SelectValue placeholder="Add currency" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {addable.map((c) => (
              <SelectItem key={c} value={c}>
                <span className="font-mono">{c}</span>
                <span className="ml-2 text-muted-foreground">{name(c)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {comparison?.date && (
          <p className="text-xs text-muted-foreground">
            ECB reference rates · {format(parseISO(comparison.date), "MMM d, yyyy")}
            {!compact && ` · trend over ${TREND_DAYS} days`}
          </p>
        )}
      </div>
    </div>
  );
}

// The Feed's quick popup: the same comparison, trimmed for a phone sheet,
// with a way through to the full page.
export function ExchangeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Exchange rates</DialogTitle>
          <DialogDescription>
            Quick comparison.{" "}
            <Link to="/dashboard/exchange" className="underline underline-offset-2 hover:text-foreground">
              Open the full page
            </Link>
          </DialogDescription>
        </DialogHeader>
        {open && <ExchangeCompare compact />}
      </DialogContent>
    </Dialog>
  );
}
