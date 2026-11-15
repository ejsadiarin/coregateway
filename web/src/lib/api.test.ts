import { describe, expect, it } from "vitest";
import { ApiError, isUnknownCategoryError, throwApiError } from "./api";

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

describe("throwApiError", () => {
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
