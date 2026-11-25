import { describe, expect, it } from "vitest";
import {
  DEFAULT_PINNED,
  compareRates,
  formatMoney,
  groupCodes,
  parseAmount,
  parseSavedRates,
  seriesCodes,
  togglePin,
} from "./exchange";

const series = {
  base: "EUR",
  rates: {
    "2026-11-20": { USD: 1.1, JPY: 165, PHP: 66 },
    "2026-10-23": { USD: 1.2, JPY: 165, PHP: 60 },
    "2026-11-02": { USD: 1.17, PHP: 65 },
  },
};

describe("compareRates", () => {
  it("crosses any pair at the latest date and keeps target order", () => {
    const c = compareRates(series, "PHP", ["JPY", "USD"], 1000);
    expect(c.date).toBe("2026-11-20");
    expect(c.rows.map((r) => r.code)).toEqual(["JPY", "USD"]);
    const [jpy, usd] = c.rows;
    expect(jpy.rate).toBeCloseTo(2.5);
    expect(jpy.history).toHaveLength(2);
    expect(usd.rate).toBeCloseTo(1 / 60);
    expect(usd.inverse).toBeCloseTo(60);
    expect(usd.converted).toBeCloseTo(1000 / 60);
    expect(usd.history.map((v) => +v.toFixed(4))).toEqual([0.02, 0.018, 0.0167]);
    expect(usd.change).toBeCloseTo(-16.667, 2);
  });

  it("converts to and from the series' own base", () => {
    expect(compareRates(series, "PHP", ["EUR"], 132).rows[0].converted).toBeCloseTo(2);
    expect(compareRates(series, "EUR", ["PHP"], 2).rows[0].converted).toBeCloseTo(132);
  });

  it("skips the base and targets the series never mentions", () => {
    const c = compareRates(series, "PHP", ["PHP", "XYZ", "USD"], 1);
    expect(c.rows.map((r) => r.code)).toEqual(["USD"]);
  });

  it("has no change for a single published date", () => {
    const c = compareRates({ base: "EUR", rates: { "2026-11-20": { USD: 1.1 } } }, "EUR", ["USD"], 1);
    expect(c.rows[0].change).toBeNull();
  });

  it("answers an empty series with no date and no rows", () => {
    expect(compareRates({ base: "EUR", rates: {} }, "PHP", ["USD"], 1)).toEqual({ date: null, rows: [] });
  });
});

describe("groupCodes", () => {
  it("puts pinned codes first in pinned order, the rest as given", () => {
    expect(groupCodes(["AUD", "GBP", "JPY", "EUR", "KRW", "PHP", "USD"], DEFAULT_PINNED)).toEqual({
      pinned: ["PHP", "USD", "JPY", "KRW", "GBP"],
      others: ["AUD", "EUR"],
    });
  });

  it("lists only the pinned codes it was given", () => {
    expect(groupCodes(["GBP", "AUD"], DEFAULT_PINNED)).toEqual({ pinned: ["GBP"], others: ["AUD"] });
  });
});

describe("togglePin", () => {
  const setup = { base: "USD", pinned: ["PHP", "JPY"], targets: ["EUR", "SGD"] };

  it("pins last and takes the currency out of the others", () => {
    expect(togglePin(setup, "SGD")).toEqual({ base: "USD", pinned: ["PHP", "JPY", "SGD"], targets: ["EUR"] });
  });

  it("unpins to the top of the others", () => {
    expect(togglePin(setup, "PHP")).toEqual({ base: "USD", pinned: ["JPY"], targets: ["PHP", "EUR", "SGD"] });
  });

  it("never lists an unpinned currency twice", () => {
    expect(togglePin({ ...setup, targets: ["PHP", "EUR"] }, "PHP").targets).toEqual(["PHP", "EUR"]);
  });
});

describe("seriesCodes", () => {
  it("lists the base and every quoted currency", () => {
    expect(seriesCodes(series)).toEqual(["EUR", "JPY", "PHP", "USD"]);
  });
});

describe("parseSavedRates", () => {
  it("reads a saved copy back", () => {
    const saved = { fetchedAt: 1, series };
    expect(parseSavedRates(JSON.stringify(saved))).toEqual(saved);
  });

  it("treats missing or malformed copies as none", () => {
    for (const raw of [null, "", "{", "null", "{}", '{"fetchedAt":1,"series":{"base":"EUR"}}', '{"fetchedAt":1,"series":{"base":"EUR","rates":{}}}', '{"fetchedAt":1,"series":{"base":"EUR","rates":{"2026-11-20":null}}}']) {
      expect(parseSavedRates(raw)).toBeUndefined();
    }
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
