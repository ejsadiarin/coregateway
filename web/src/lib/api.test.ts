import { describe, expect, it } from "vitest";
import {
  ApiError,
  isRateUnavailableError,
  isUnknownCategoryError,
  isUnsupportedCurrencyError,
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
