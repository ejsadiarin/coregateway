import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchCurrentUser,
  isRateUnavailableError,
  isUnknownCategoryError,
  isUnsupportedCurrencyError,
  sessionRetryDelay,
  throwApiError,
} from "./api";

describe("isUnknownCategoryError", () => {
  it("recognises corefinance's 400 for a category no longer in the fixed list", () => {
    expect(
      isUnknownCategoryError(new ApiError(400, "unknown category: pick one from the category list")),
    ).toBe(true);
  });

  it("ignores other refusals", () => {
    expect(isUnknownCategoryError(new ApiError(400, "invalid request body"))).toBe(false);
    expect(isUnknownCategoryError(new ApiError(500, "unknown category: pick one from the category list"))).toBe(false);
    expect(isUnknownCategoryError(new Error("unknown category: pick one from the category list"))).toBe(false);
  });
});

describe("isUnsupportedCurrencyError", () => {
  it("recognises corefinance's 400 for an unpriced currency", () => {
    expect(isUnsupportedCurrencyError(new ApiError(400, "unsupported currency: XYZ"))).toBe(true);
    expect(isUnsupportedCurrencyError(new ApiError(400, "invalid request body"))).toBe(false);
    expect(isUnsupportedCurrencyError(new ApiError(502, "unsupported currency: XYZ"))).toBe(false);
  });
});

describe("isRateUnavailableError", () => {
  it("recognises a 502 from the rate provider", () => {
    expect(isRateUnavailableError(new ApiError(502, "exchange rate unavailable: provider returned 500"))).toBe(true);
    expect(isRateUnavailableError(new ApiError(502, "bad gateway"))).toBe(false);
    expect(isRateUnavailableError(new ApiError(400, "unsupported currency: XYZ"))).toBe(false);
  });
});

describe("throwApiError", () => {
  it("keeps a 502 rate explanation", async () => {
    const res = new Response(JSON.stringify({ error: "exchange rate unavailable: provider returned 500" }), {
      status: 502,
    });
    const error = await throwApiError(res, "Request failed (error 502)").catch((e: unknown) => e);

    expect(isRateUnavailableError(error)).toBe(true);
  });

  it("keeps corefinance's 400 explanation, so a stale category is recognisable", async () => {
    const res = new Response(
      JSON.stringify({ error: "unknown category: pick one from the category list" }),
      { status: 400 },
    );
    const error = await throwApiError(res, "Error creating expense: 400").catch((e: unknown) => e);

    expect(isUnknownCategoryError(error)).toBe(true);
  });

  it("keeps the caller's summary for a failure the owner can't fix", async () => {
    const res = new Response(JSON.stringify({ error: "connection refused" }), { status: 500 });
    const error = await throwApiError(res, "Error creating expense: 500").catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 500, detail: "Error creating expense: 500" });
  });
});

describe("sessionRetryDelay", () => {
  it("backs off from 1s, doubling, capped at 15s", () => {
    expect([0, 1, 2, 3, 4, 10].map(sessionRetryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
});

describe("fetchCurrentUser", () => {
  const respond = (status: number, body: unknown = {}) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

  afterEach(() => vi.restoreAllMocks());

  it("is null only when the gateway says the session is gone", async () => {
    respond(401);
    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("throws, not signs out, when the check itself fails", async () => {
    respond(503);
    await expect(fetchCurrentUser()).rejects.toThrow();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchCurrentUser()).rejects.toThrow("Failed to fetch");
  });

  it("returns the signed-in user", async () => {
    respond(200, { id: "u1", email: "owner@example.com", role: "admin" });
    await expect(fetchCurrentUser()).resolves.toMatchObject({ id: "u1" });
  });
});
