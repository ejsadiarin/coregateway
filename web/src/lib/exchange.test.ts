import { describe, expect, it } from "vitest";
import { compareRates, formatMoney, parseAmount } from "./exchange";

const series = {
  base: "PHP",
  rates: {
    "2026-11-20": { USD: 0.016, JPY: 2.5 },
    "2026-10-23": { USD: 0.02, JPY: 2.5 },
    "2026-11-02": { USD: 0.018 },
  },
};

describe("compareRates", () => {
  it("uses the latest date and keeps target order", () => {
    const c = compareRates(series, ["JPY", "USD"], 1000);
    expect(c.date).toBe("2026-11-20");
    expect(c.rows.map((r) => r.code)).toEqual(["JPY", "USD"]);
    const usd = c.rows[1];
    expect(usd.rate).toBe(0.016);
    expect(usd.converted).toBeCloseTo(16);
    expect(usd.inverse).toBeCloseTo(62.5);
    expect(usd.history).toEqual([0.02, 0.018, 0.016]);
    expect(usd.change).toBeCloseTo(-20);
  });

  it("skips the base and targets the series never mentions", () => {
    const c = compareRates(series, ["PHP", "EUR", "USD"], 1);
    expect(c.rows.map((r) => r.code)).toEqual(["USD"]);
  });

  it("has no change for a single published date", () => {
    const c = compareRates({ base: "PHP", rates: { "2026-11-20": { USD: 0.016 } } }, ["USD"], 1);
    expect(c.rows[0].change).toBeNull();
  });

  it("answers an empty series with no date and no rows", () => {
    expect(compareRates({ base: "PHP", rates: {} }, ["USD"], 1)).toEqual({ date: null, rows: [] });
  });
});

describe("parseAmount", () => {
  it("reads commas and spaces, refuses junk and negatives", () => {
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount(" 10 000 ")).toBe(10000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("adds decimals only for tiny values", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(0.0157, "USD")).toBe("$0.0157");
  });
});
