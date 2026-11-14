import { describe, expect, it } from "vitest";
import { budgetPostedAt, syncRecordOf, chunk, notYet } from "./budget-sync";
import type { Expense, Income } from "@/types/api";

// Expectations are built from local time, so they hold in any timezone.
const local = (s: string) => new Date(s);

describe("budgetPostedAt", () => {
  it("keeps the creation time for a record entered on its own day", () => {
    const created = local("2026-11-13T19:05:00");
    expect(new Date(budgetPostedAt("2026-11-13", created.toISOString())).getTime()).toBe(created.getTime());
  });

  it("puts a record entered on another day at local noon of its date", () => {
    const at = new Date(budgetPostedAt("2026-05-05", "2026-11-14T08:49:20Z"));
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([
      2026, 4, 5, 12, 0,
    ]);
  });

  it("writes an RFC 3339 time with the local offset", () => {
    expect(budgetPostedAt("2026-05-05", "2026-11-14T08:49:20Z")).toMatch(
      /^2026-05-05T12:00:00(Z|[+-]\d\d:\d\d)$/,
    );
  });
});

describe("syncRecordOf", () => {
  it("reads an expense's date and an income's date", () => {
    const e = { id: "e1", expense_date: "2026-05-05T00:00:00Z", created_at: "2026-11-14T08:49:20Z" } as Expense;
    const i = { id: "i1", date: "2026-06-02", created_at: "2026-11-14T08:49:20Z" } as Income;
    expect(syncRecordOf("expense", e)).toMatchObject({ kind: "expense", id: "e1", date: "2026-05-05" });
    expect(syncRecordOf("income", i)).toMatchObject({ kind: "income", id: "i1", date: "2026-06-02" });
  });
});

describe("chunk", () => {
  it("splits into pieces of at most n", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("notYet", () => {
  it("holds back only records dated after today", () => {
    const r = (date: string) => ({ kind: "expense" as const, id: "x", date, posted_at: "" });
    expect(notYet(r("2026-12-15"), "2026-11-14")).toBe(true);
    expect(notYet(r("2026-11-14"), "2026-11-14")).toBe(false);
    expect(notYet(r("2026-05-05"), "2026-11-14")).toBe(false);
  });
});
