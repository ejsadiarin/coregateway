import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpDown, ArrowUpRight, Pin, RefreshCw, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  DEFAULT_BASE,
  DEFAULT_PINNED,
  DEFAULT_TARGETS,
  TREND_DAYS,
  compareRates,
  currencyName,
  formatMoney,
  groupCodes,
  parseAmount,
  seriesCodes,
  togglePin,
  type ComparisonRow,
} from "@/lib/exchange";
import { useExchangeRates } from "@/hooks/use-exchange-rates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// The page and the Feed popup share one remembered setup, so a currency added
// in either shows in both. Per-viewer convenience only: storage can be
// missing (private window) and the defaults stand in.
const STORAGE_KEY = "core-exchange";

interface Setup {
  base: string;
  // Always compared, and first in the From list.
  pinned: string[];
  // Compared besides the pinned ones.
  targets: string[];
  amount: string;
}

function loadSetup(): Setup {
  const fallback = { base: DEFAULT_BASE, pinned: DEFAULT_PINNED, targets: DEFAULT_TARGETS, amount: "1000" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Setup>;
    return {
      base: typeof s.base === "string" ? s.base : fallback.base,
      pinned: Array.isArray(s.pinned) ? [...new Set(s.pinned.filter((p) => typeof p === "string"))] : fallback.pinned,
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

// One bordered list of rows under its label. Rows can be removed only where
// onRemove is given; pinned ones are unpinned first.
function RateGroup({
  label,
  pinned = false,
  rows,
  pending,
  base,
  value,
  compact,
  onBase,
  onTogglePin,
  onRemove,
}: {
  label: string;
  pinned?: boolean;
  rows?: ComparisonRow[];
  pending: number;
  base: string;
  value: number | null;
  compact: boolean;
  onBase: (code: string) => void;
  onTogglePin?: (code: string) => void;
  onRemove?: (code: string) => void;
}) {
  if (!rows?.length && pending === 0) return null;
  return (
    <section aria-label={label} className="space-y-1.5">
      <h2 className="text-xs text-muted-foreground">{label}</h2>
      <ul className="divide-y divide-border rounded-lg border border-border" aria-busy={pending > 0}>
        {Array.from({ length: pending }, (_, i) => (
          <li key={i} className="flex h-16 items-center px-3">
            <div className="h-4 w-full animate-pulse rounded bg-muted/40" />
          </li>
        ))}
        {rows?.map((row) => (
          <li key={row.code} className="flex items-center gap-3 px-3 py-2.5">
            <button
              type="button"
              onClick={() => onBase(row.code)}
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
                {!compact && <span className="hidden sm:inline"> · {currencyName(row.code)}</span>}
              </div>
            </div>
            {/* Stacked on a phone, so the trend leaves the amount its room. */}
            <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-3">
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
            </div>
            <div className="flex shrink-0">
              {onTogglePin && (
                <button
                  type="button"
                  onClick={() => onTogglePin(row.code)}
                  className="flex h-11 w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={`${pinned ? "Unpin" : "Pin"} ${row.code}`}
                  title={`${pinned ? "Unpin" : "Pin"} ${row.code}`}
                >
                  <Pin className={cn("h-4 w-4", pinned && "fill-current text-primary")} aria-hidden />
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(row.code)}
                  className="flex h-11 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${row.code}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExchangeCompare({ compact = false }: { compact?: boolean }) {
  const [setup, setSetup] = useState<Setup>(loadSetup);
  useEffect(() => saveSetup(setup), [setup]);
  const { base, pinned: pins, targets, amount } = setup;
  const value = parseAmount(amount);

  const rates = useExchangeRates();
  const codes = useMemo(() => (rates.data ? seriesCodes(rates.data) : [base]), [rates.data, base]);
  const choices = groupCodes(codes, pins);
  // Saved setups from before pinning may name a pinned currency.
  const extras = groupCodes(targets, pins).others.filter((t) => t !== base);
  const addable = choices.others.filter((c) => c !== base && !targets.includes(c));

  const compare = (group: string[]) => (rates.data ? compareRates(rates.data, base, group, value ?? 0) : null);
  const pinned = compare(pins);
  const others = compare(extras);
  const date = pinned?.date;

  const setBase = (next: string) =>
    setSetup((s) => ({
      ...s,
      base: next,
      // The old base becomes a target so swapping back is one tap.
      targets: groupCodes([s.base, ...s.targets.filter((t) => t !== next && t !== s.base)], s.pinned).others,
    }));

  const rowProps = {
    base,
    value,
    compact,
    onBase: setBase,
    // Pins are changed on the full page; the popup only shows them.
    onTogglePin: compact ? undefined : (code: string) => setSetup((s) => togglePin(s, code)),
  };

  return (
    // min-w-0: in the popup's grid a long amount truncates, not widens it.
    <div className="min-w-0 space-y-4">
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
              {choices.pinned.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs font-normal text-muted-foreground">Pinned</SelectLabel>
                  {choices.pinned.map((c) => (
                    <SelectItem key={c} value={c} className="font-mono">
                      {c}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {choices.pinned.length > 0 && choices.others.length > 0 && <SelectSeparator className="bg-border" />}
              {choices.others.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs font-normal text-muted-foreground">Others</SelectLabel>
                  {choices.others.map((c) => (
                    <SelectItem key={c} value={c} className="font-mono">
                      {c}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {rates.isError && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
            rates.data ? "border-border text-muted-foreground" : "border-destructive/40 text-destructive",
          )}
        >
          {date
            ? `Couldn't refresh. Showing saved rates from ${format(parseISO(date), "MMM d, yyyy")}.`
            : "Couldn't load exchange rates."}
          <Button variant="ghost" size="sm" disabled={rates.isFetching} onClick={() => rates.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </Button>
        </div>
      )}

      <RateGroup
        label="Pinned"
        pinned
        rows={pinned?.rows}
        pending={rates.isLoading ? pins.filter((p) => p !== base).length : 0}
        {...rowProps}
      />
      <RateGroup
        label="Others"
        rows={others?.rows}
        pending={rates.isLoading ? extras.length : 0}
        onRemove={(code) => setSetup((s) => ({ ...s, targets: s.targets.filter((t) => t !== code) }))}
        {...rowProps}
      />

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
                <span className="ml-2 text-muted-foreground">{currencyName(c)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {date && (
          <p className="text-xs text-muted-foreground">
            ECB reference rates · {format(parseISO(date), "MMM d, yyyy")}
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
