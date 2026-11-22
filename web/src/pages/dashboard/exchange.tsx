import { ExchangeCompare } from "@/components/exchange/exchange-compare";

export default function ExchangePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">Exchange</h1>
      <p className="mt-2 mb-6 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        Compare one amount across currencies. Tap a code to convert from it instead.
      </p>
      <ExchangeCompare />
    </div>
  );
}
