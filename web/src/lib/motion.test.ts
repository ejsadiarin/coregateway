import { describe, expect, it } from "vitest";
import { digitKeys, odometerSlots, staggerDelay, tabEnterFrom } from "./motion";

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

// The typed amount's digits roll in and out; a digit keeps its key while
// it stays, so only the ones typed or deleted move.
describe("digitKeys", () => {
  it("keeps the keys of the digits before and after an edit and gives new digits new keys", () => {
    const typed = digitKeys("", [], "125", 0);
    expect(typed.keys).toEqual(["0", "1", "2"]);
    // A digit typed in the middle: 1 and 2·5 keep theirs.
    const inserted = digitKeys("125", typed.keys, "1725", typed.next);
    expect(inserted.keys).toEqual(["0", "3", "1", "2"]);
    // Deleting it gives the rest their keys back.
    expect(digitKeys("1725", inserted.keys, "125", inserted.next).keys).toEqual(["0", "1", "2"]);
  });

  it("keeps every key when nothing changed", () => {
    expect(digitKeys("42", ["7", "9"], "42", 10)).toEqual({ keys: ["7", "9"], next: 10 });
  });
});

// An odometer rolls a column per digit and keeps the rest still; places
// are counted from the right so a figure growing a digit rolls in place.
describe("odometerSlots", () => {
  it("makes each digit a column and leaves signs and separators plain", () => {
    expect(odometerSlots("-₱1,05")).toEqual([
      { key: "5", char: "-", digit: null },
      { key: "4", char: "₱", digit: null },
      { key: "3", char: "1", digit: 1 },
      { key: "2", char: ",", digit: null },
      { key: "1", char: "0", digit: 0 },
      { key: "0", char: "5", digit: 5 },
    ]);
  });

  it("keeps the ones place's key when the figure grows on the left", () => {
    expect(odometerSlots("99").at(-1)?.key).toBe(odometerSlots("100").at(-1)?.key);
  });
});
