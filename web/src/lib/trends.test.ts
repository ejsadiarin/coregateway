import { describe, expect, it } from "vitest";
import { latestTwo } from "./trends";

describe("latestTwo", () => {
  it("takes the newest month from corefinance's newest-first list", () => {
    const { latest, previous } = latestTwo([
      { month: "2026-11" },
      { month: "2026-10" },
      { month: "2026-09" },
    ]);

    expect(latest?.month).toBe("2026-11");
    expect(previous?.month).toBe("2026-10");
  });

  it("handles one month and none", () => {
    expect(latestTwo([{ month: "2026-11" }])).toEqual({ latest: { month: "2026-11" }, previous: undefined });
    expect(latestTwo(undefined)).toEqual({ latest: undefined, previous: undefined });
  });
});
