import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptDeviceTimezone, fetchUserTimezone, saveUserTimezone, type UserTimezone } from "@/lib/user-timezone";

// The gateway owns a user's timezone (ADR-0005). A user who never saved one
// reads as UTC and starts on this device's zone instead, once.
const userId = "6f1c1d2e-0000-4000-8000-000000000001";
const unset: UserTimezone = { user_id: userId, timezone: "UTC", saved: false };

describe("adoptDeviceTimezone", () => {
  it("starts a user who never saved a timezone on this device's zone", async () => {
    const save = vi.fn(async (timezone: string) => ({ ...unset, timezone, saved: true }));
    const got = await adoptDeviceTimezone(unset, "Asia/Manila", save);
    expect(save).toHaveBeenCalledWith("Asia/Manila");
    expect(got).toEqual({ user_id: userId, timezone: "Asia/Manila", saved: true });
  });

  it("never overrides a timezone the user saved, even UTC", async () => {
    const save = vi.fn();
    const chosen = { ...unset, saved: true };
    expect(await adoptDeviceTimezone(chosen, "Asia/Manila", save)).toBe(chosen);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps UTC when the device's zone can't be saved", async () => {
    const save = vi.fn(async () => {
      throw new Error("timezone must be an IANA zone such as Asia/Manila");
    });
    expect(await adoptDeviceTimezone(unset, "Asia/Manila", save)).toBe(unset);
  });

  it("keeps UTC when the browser names no zone", async () => {
    const save = vi.fn();
    expect(await adoptDeviceTimezone(unset, undefined, save)).toBe(unset);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("the gateway timezone endpoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  it("reads the user's timezone from the gateway, not a downstream", async () => {
    const fetchMock = respond(unset);
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchUserTimezone(userId)).toEqual(unset);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/users/${userId}/timezone$`));
    expect(init.credentials).toBe("include");
  });

  it("saves the timezone to the gateway", async () => {
    const saved = { ...unset, timezone: "Asia/Manila", saved: true };
    const fetchMock = respond(saved);
    vi.stubGlobal("fetch", fetchMock);
    expect(await saveUserTimezone(userId, "Asia/Manila")).toEqual(saved);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/users/${userId}/timezone$`));
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ timezone: "Asia/Manila" });
  });

  it("reports the gateway's reason when a save is refused", async () => {
    vi.stubGlobal("fetch", respond({ error: "timezone must be an IANA zone such as Asia/Manila" }, 400));
    await expect(saveUserTimezone(userId, "Mars/Base")).rejects.toThrow("timezone must be an IANA zone such as Asia/Manila");
  });
});
