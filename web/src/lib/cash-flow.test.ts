import { describe, expect, it } from "vitest";
import { CASH_FLOW_WINDOW_LABELS, cashFlowMax, isCurrentBucket } from "./cash-flow";

describe("cash flow series", () => {
  it("labels the window the page asks for", () => {
    expect(CASH_FLOW_WINDOW_LABELS.month).toBe("Last 6 months");
  });

  it("scales bars to the tallest value and never divides by zero", () => {
    expect(cashFlowMax([{ income: 10, spent: 40 }])).toBe(40);
    expect(cashFlowMax([])).toBe(1);
    expect(cashFlowMax([{ income: 0, spent: 0 }])).toBe(1);
  });

  it("marks only the last bucket as current", () => {
    expect(isCurrentBucket(13, 14)).toBe(true);
    expect(isCurrentBucket(12, 14)).toBe(false);
    expect(isCurrentBucket(0, 0)).toBe(false);
  });
});
