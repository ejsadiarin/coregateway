import { describe, expect, it } from "vitest";
import { staleReport } from "./rule-review";

describe("staleReport", () => {
  it("asks about the entries the owner edited and counts the ones skipped for them", () => {
    const report = staleReport([
      { id: "a", date: "2026-11-05", status: "posted", needs_review: true },
      { id: "b", date: "2026-10-05", status: "skipped", needs_review: false },
      { id: "c", date: "2026-09-05", status: "skipped", needs_review: false },
    ]);
    expect(report.review.map((e) => e.id)).toEqual(["a"]);
    expect(report.skipped).toBe(2);
  });

  it("has nothing to say when the schedule didn't change", () => {
    expect(staleReport(undefined)).toEqual({ review: [], skipped: 0 });
    expect(staleReport([])).toEqual({ review: [], skipped: 0 });
  });
});
