import { describe, expect, it } from "vitest";
import {
  addCurrencyAmount,
  currencyTotals,
  netCurrencyTotals,
  phpAmount,
  totalsByCurrency,
} from "./format";

describe("phpAmount", () => {
  it("uses the fixed PHP amount a saved record carries", () => {
    expect(phpAmount({ amount: 100, currency: "USD", amount_php: "6157.30" })).toBe(6157.3);
    expect(phpAmount({ amount: 100, currency: "USD", amountPHP: 6157.3 })).toBe(6157.3);
    expect(phpAmount({ amount: 100, currency: "USD", conversion: { amountPHP: 6157.3 } })).toBe(6157.3);
  });

  it("falls back to the original amount only when the record is PHP", () => {
    expect(phpAmount({ amount: 500, currency: "PHP" })).toBe(500);
    expect(phpAmount({ amount: 500 })).toBe(500);
    expect(phpAmount({ amount: 100, currency: "USD" })).toBeNaN();
  });
});

describe("currency totals", () => {
  it("groups by currency, PHP first then alphabetical, omitting zero", () => {
    const by = new Map<string, number>();
    addCurrencyAmount(by, "USD", 5);
    addCurrencyAmount(by, "PHP", 1200);
    addCurrencyAmount(by, "JPY", 3000);
    addCurrencyAmount(by, "PHP", 300);
    addCurrencyAmount(by, "EUR", 0);

    expect(currencyTotals(by)).toEqual([
      { currency: "PHP", amount: 1500 },
      { currency: "JPY", amount: 3000 },
      { currency: "USD", amount: 5 },
    ]);
  });

  it("defaults an omitted currency to PHP and ignores a non-finite amount", () => {
    const by = new Map<string, number>();
    addCurrencyAmount(by, undefined, 500);
    addCurrencyAmount(by, "php", 100);
    addCurrencyAmount(by, "USD", Number.NaN);

    expect(currencyTotals(by)).toEqual([{ currency: "PHP", amount: 600 }]);
  });

  it("groups a rule list by currency, coercing string amounts", () => {
    expect(
      totalsByCurrency([
        { amount: 1000, currency: "PHP" },
        { amount: "5", currency: "USD" },
        { amount: 3000, currency: "JPY" },
      ]),
    ).toEqual([
      { currency: "PHP", amount: 1000 },
      { currency: "JPY", amount: 3000 },
      { currency: "USD", amount: 5 },
    ]);
  });

  it("keeps a PHP-only list on one line", () => {
    expect(totalsByCurrency([{ amount: 1000 }, { amount: 200 }])).toEqual([
      { currency: "PHP", amount: 1200 },
    ]);
  });

  it("nets income and expenses by currency", () => {
    expect(
      netCurrencyTotals(
        [
          { currency: "PHP", amount: 1000 },
          { currency: "USD", amount: 5 },
        ],
        [
          { currency: "PHP", amount: 200 },
          { currency: "JPY", amount: 3000 },
        ],
      ),
    ).toEqual([
      { currency: "PHP", amount: 800 },
      { currency: "JPY", amount: -3000 },
      { currency: "USD", amount: 5 },
    ]);
  });

  it("keeps a currency that nets to zero when it appears on either side", () => {
    expect(
      netCurrencyTotals(
        [
          { currency: "PHP", amount: 1000 },
          { currency: "USD", amount: 5 },
        ],
        [{ currency: "USD", amount: 5 }],
      ),
    ).toEqual([
      { currency: "PHP", amount: 1000 },
      { currency: "USD", amount: 0 },
    ]);
  });
});
