import { describe, expect, it } from "vitest";
import type { Entry, Rule } from "./ledger";
import { groupNewByRule, loadCursor, readFeedSince, saveCursor, staleReport, type FeedPage } from "./rule-review";

describe("staleReport", () => {
  it("asks about the entries the owner edited and counts the ones skipped for them", () => {
    const report = staleReport([
      { id: "a", date: "2026-11-05", status: "posted", needs_review: true },
      { id: "b", date: "2026-10-05", status: "skipped", needs_review: false },
      { id: "c", date: "2026-09-05", status: "skipped", needs_review: false },
    ]);
    expect(report.review.map((e) => e.id)).toEqual(["a"]);
    expect(report.skipped).toBe(2);
  });

  it("has nothing to say when the schedule didn't change", () => {
    expect(staleReport(undefined)).toEqual({ review: [], skipped: 0 });
    expect(staleReport([])).toEqual({ review: [], skipped: 0 });
  });
});

describe("readFeedSince", () => {
  const e = (kind: "expense" | "income", id: string) => ({ kind, id });

  it("reads page after page until a short one, keeping one kind", async () => {
    const pages: Record<string, FeedPage> = {
      c0: { entries: [e("expense", "a"), e("income", "b")], next: "c1" },
      c1: { entries: [e("expense", "c"), e("expense", "d")], next: "c2" },
      c2: { entries: [e("income", "f")], next: "c3" },
    };
    const asked: (string | undefined)[] = [];
    const got = await readFeedSince("c0", async (after) => {
      asked.push(after);
      return pages[after!];
    }, "expense", 2);
    expect(asked).toEqual(["c0", "c1", "c2"]);
    expect(got).toEqual({ ids: ["a", "c", "d"], next: "c3" });
  });

  it("starts from the beginning without a cursor and moves to where the feed ends", async () => {
    const got = await readFeedSince(undefined, async (after) => {
      expect(after).toBeUndefined();
      return { entries: [], next: "end" };
    }, "income", 2);
    expect(got).toEqual({ ids: [], next: "end" });
  });
});

describe("review cursor", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const broken = {
    getItem: (): string | null => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  it("keeps one cursor per kind, so reviewing expenses leaves incomes alone", () => {
    const store = memory();
    saveCursor("expense", "e9", store);
    expect(loadCursor("expense", store)).toBe("e9");
    expect(loadCursor("income", store)).toBeUndefined();
  });

  it("acts as a first visit when storage is blocked", () => {
    expect(() => saveCursor("expense", "e9", broken)).not.toThrow();
    expect(loadCursor("expense", broken)).toBeUndefined();
    expect(loadCursor("expense", undefined)).toBeUndefined();
  });
});

describe("groupNewByRule", () => {
  const entry = (id: string, ruleId: string, date: string, amount = 500): Entry => ({
    id,
    kind: "expense",
    description: "baon",
    amount,
    currency: "PHP",
    date,
    notes: "",
    priority: "need",
    status: "posted",
    ruleId,
    createdAt: "2026-11-15T00:00:00Z",
  });
  const rule = (id: string, description: string): Rule => ({
    id,
    kind: "expense",
    description,
    amount: 500,
    currency: "PHP",
    cadence: "daily",
    startDate: "2026-11-01",
    notes: "",
    priority: "need",
    active: true,
  });

  it("groups the new entries under their rules, newest first, as the ledger has them now", () => {
    const entries = [
      entry("m1", "baon", "2026-11-12"),
      entry("m2", "baon", "2026-11-14", 300),
      entry("s1", "spotify", "2026-11-13", 85),
      entry("old", "baon", "2026-11-01"),
    ];
    const groups = groupNewByRule(["m1", "s1", "m2"], entries, [rule("baon", "Baon"), rule("spotify", "Spotify")]);
    expect(groups.map((g) => [g.rule?.description, g.entries.map((e) => `${e.id}:${e.amount}`)])).toEqual([
      ["Baon", ["m2:300", "m1:500"]],
      ["Spotify", ["s1:85"]],
    ]);
  });

  it("leaves out new entries that are gone, and keeps ones whose rule is gone", () => {
    const groups = groupNewByRule(["deleted", "orphan"], [entry("orphan", "gone", "2026-11-10")], []);
    expect(groups).toEqual([{ ruleId: "gone", rule: undefined, entries: [entry("orphan", "gone", "2026-11-10")] }]);
  });
});
