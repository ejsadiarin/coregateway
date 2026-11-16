import { describe, expect, it } from "vitest";
import { phpAmount } from "./format";

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
