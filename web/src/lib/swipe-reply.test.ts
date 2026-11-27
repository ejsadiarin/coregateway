import { describe, expect, it } from "vitest";
import { SWIPE, swipeIntent, swipeOffset } from "./swipe-reply";

describe("swipeIntent", () => {
  it("waits until the finger has moved past the slop", () => {
    expect(swipeIntent(-5, 2)).toBeNull();
  });

  it("is a swipe once the drag is clearly leftward", () => {
    expect(swipeIntent(-20, 5)).toBe("swipe");
  });

  it("leaves a vertical, diagonal, or rightward drag to the page", () => {
    expect(swipeIntent(-4, 30)).toBe("ignore");
    expect(swipeIntent(-20, 18)).toBe("ignore");
    expect(swipeIntent(20, 0)).toBe("ignore");
  });
});

describe("swipeOffset", () => {
  it("never moves the bubble right", () => {
    expect(swipeOffset(40)).toBe(0);
  });

  it("lags the finger, so a short swipe stays short of the mark", () => {
    expect(swipeOffset(-30)).toBeGreaterThan(-SWIPE.mark);
    expect(swipeOffset(-150)).toBeLessThanOrEqual(-SWIPE.mark);
  });

  it("stops at its furthest", () => {
    expect(swipeOffset(-1000)).toBe(-SWIPE.max);
  });
});
