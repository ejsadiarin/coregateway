import { describe, expect, it, vi } from "vitest";
import { adoptBudgetTimezone, type BudgetSettings } from "@/lib/budget-settings";

// corefinance dates rule entries in the user's timezone (#9); a user who
// never saved one starts on this device's zone instead of UTC.
const defaults: BudgetSettings = { timezone: "UTC", saved: false };

describe("adoptBudgetTimezone", () => {
  it("starts a user who never saved settings on this device's zone", async () => {
    const save = vi.fn(async (timezone: string) => ({ timezone, saved: true }));
    const got = await adoptBudgetTimezone(defaults, "Asia/Manila", save);
    expect(save).toHaveBeenCalledWith("Asia/Manila");
    expect(got).toEqual({ timezone: "Asia/Manila", saved: true });
  });

  it("never overrides a timezone the user saved, even UTC", async () => {
    const save = vi.fn();
    const chosen = { ...defaults, saved: true };
    expect(await adoptBudgetTimezone(chosen, "Asia/Manila", save)).toBe(chosen);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the default when the device's zone can't be saved", async () => {
    const save = vi.fn(async () => {
      throw new Error("timezone must be an IANA zone such as Asia/Manila");
    });
    expect(await adoptBudgetTimezone(defaults, "Asia/Manila", save)).toBe(defaults);
  });

  it("keeps the default when the browser names no zone", async () => {
    const save = vi.fn();
    expect(await adoptBudgetTimezone(defaults, undefined, save)).toBe(defaults);
    expect(save).not.toHaveBeenCalled();
  });
});
