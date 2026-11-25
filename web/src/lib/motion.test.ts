import { describe, expect, it } from "vitest";
import { staggerDelay, tabEnterFrom } from "./motion";

// DESIGN §6: a list cascades 0.06s apart for its first five items, then
// the rest come in together with the fifth.
describe("staggerDelay", () => {
  it("spaces the first five items 0.06s apart and holds the rest at the cap", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 40].map(staggerDelay)).toEqual([0, 0.06, 0.12, 0.18, 0.24, 0.24, 0.24, 0.24]);
  });
});

// On a phone, a page reached from the bottom nav comes in from the side of
// the tab that was picked; anything else is not a move between tabs.
describe("tabEnterFrom", () => {
  const tabs = ["/dashboard/feed", "/dashboard", "/dashboard/budget", "/dashboard/budget/expenses"];

  it("comes in from the right for a tab to the right, and from the left for one to the left", () => {
    expect(tabEnterFrom(tabs, "/dashboard/feed", "/dashboard/budget")).toBe("right");
    expect(tabEnterFrom(tabs, "/dashboard/budget/expenses", "/dashboard")).toBe("left");
  });

  it("is null when either end is not a tab, or the tab is the same", () => {
    expect(tabEnterFrom(tabs, "/dashboard/feed", null)).toBeNull();
    expect(tabEnterFrom(tabs, null, "/dashboard/feed")).toBeNull();
    expect(tabEnterFrom(tabs, "/dashboard/budget", "/dashboard/budget")).toBeNull();
  });
});
