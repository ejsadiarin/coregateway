import { describe, expect, it } from "vitest";
import { conversionLabel } from "./conversion";

describe("conversionLabel", () => {
  it("shows the original amount, PHP amount, rate and rate date", () => {
    expect(
      conversionLabel({
        currency: "USD",
        amount: 100,
        conversion: { amountPHP: 6157.3, exchangeRate: 61.573, rateDate: "2026-07-10" },
      }),
    ).toBe("$100.00 · ₱6,157.30 at 61.573 (Jul 10)");
  });

  it("hides for PHP and when the conversion fields are missing", () => {
    expect(
      conversionLabel({
        currency: "PHP",
        amount: 100,
        conversion: { amountPHP: 100, exchangeRate: 1, rateDate: "2026-07-10" },
      }),
    ).toBeUndefined();
    expect(conversionLabel({ currency: "USD", amount: 100 })).toBeUndefined();
  });

  it("hides an invalid rate date rather than throwing", () => {
    expect(
      conversionLabel({
        currency: "USD",
        amount: 100,
        conversion: { amountPHP: 6157.3, exchangeRate: 61.573, rateDate: "not-a-date" },
      }),
    ).toBeUndefined();
  });
});
