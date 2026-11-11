import { describe, expect, it, vi } from "vitest";
import { adoptDeviceTimezone } from "@/lib/kanban";
import type { KanbanSettings } from "@/types/kanban";

const defaults: KanbanSettings = { ntfy_topic: null, timezone: "UTC", saved: false };

describe("adoptDeviceTimezone", () => {
  it("starts an owner who never saved settings on this device's zone", async () => {
    const save = vi.fn(async (s: Omit<KanbanSettings, "saved">) => ({ ...s, saved: true }));
    const got = await adoptDeviceTimezone(defaults, "Asia/Manila", save);
    expect(save).toHaveBeenCalledWith({ ntfy_topic: null, timezone: "Asia/Manila" });
    expect(got).toEqual({ ntfy_topic: null, timezone: "Asia/Manila", saved: true });
  });

  it("never overrides settings the owner saved, even a chosen UTC", async () => {
    const save = vi.fn();
    const chosen = { ...defaults, saved: true };
    expect(await adoptDeviceTimezone(chosen, "Asia/Manila", save)).toBe(chosen);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the defaults when the device's zone can't be saved", async () => {
    const save = vi.fn(async () => {
      throw new Error("timezone must be an IANA zone such as Asia/Manila");
    });
    expect(await adoptDeviceTimezone(defaults, "Asia/Manila", save)).toBe(defaults);
  });

  it("keeps the defaults when the browser names no zone", async () => {
    const save = vi.fn();
    expect(await adoptDeviceTimezone(defaults, undefined, save)).toBe(defaults);
    expect(save).not.toHaveBeenCalled();
  });
});
