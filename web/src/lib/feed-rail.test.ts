import { describe, expect, it } from "vitest";
import { canSkip, skipStatus } from "./feed-rail";

describe("skipping one date", () => {
  it("is offered for rule entries only", () => {
    expect(canSkip({ source_rule_id: "r1" })).toBe(true);
    expect(canSkip({ source_rule_id: undefined })).toBe(false);
    expect(canSkip({})).toBe(false);
  });

  it("skips a posted or pending entry, and undoing lets its date decide", () => {
    expect(skipStatus("posted")).toBe("skipped");
    expect(skipStatus("pending")).toBe("skipped");
    expect(skipStatus(undefined)).toBe("skipped");
    expect(skipStatus("skipped")).toBeUndefined();
  });
});
