import { describe, expect, it } from "vitest";
import { MAX_SEARCH_RECORDS, matchRecords, searchSavedNotes, searchWords } from "./feed-search";
import type { FeedData } from "./feed";
import type { Note, NoteCard } from "@/types/feed";
import type { KanbanReminder } from "@/types/kanban";
import type { Entry } from "./ledger";

const entry = (over: Partial<Entry>): Entry => ({
  id: "e1",
  kind: "expense",
  description: "Team Lunch",
  amount: 1250.5,
  currency: "PHP",
  date: "2026-11-20",
  categoryId: "c1",
  notes: "with the crew",
  priority: "want",
  status: "posted",
  createdAt: "2026-11-20T00:00:00Z",
  ...over,
});
const categories: Record<string, string> = { c1: "Dining Out" };
const find = (q: string, entries: Entry[] = [entry({})]) =>
  matchRecords(q, entries, (id) => categories[id], "2026-11-24").records.map((r) => r.id);

describe("searchWords", () => {
  it("splits on any space and lowercases", () => {
    expect(searchWords("  Team \n LUNCH ")).toEqual(["team", "lunch"]);
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("matchRecords", () => {
  it("matches every word across description, notes and category, whatever the case", () => {
    for (const q of ["lunch", "CREW team", "dining lunch", "unc"]) expect(find(q), q).toEqual(["e1"]);
    for (const q of ["lunch taxi", "c1", "e1"]) expect(find(q), q).toEqual([]);
  });

  it("matches the amount shown, with or without its comma and sign", () => {
    for (const q of ["1250", "1,250.50", "₱1,250.5", "lunch 1250"]) expect(find(q), q).toEqual(["e1"]);
    expect(find("250.00", [entry({ amount: 250 })])).toEqual(["e1"]);
    for (const q of ["1251", ",", "₱", ".", "1250x"]) expect(find(q), q).toEqual([]);
  });

  it("finds nothing for a blank search", () => {
    expect(find("  ")).toEqual([]);
  });

  it("leaves out records dated after today, which have no note yet", () => {
    expect(find("lunch", [entry({ date: "2026-11-25" }), entry({ id: "e2", date: "2026-11-24" })])).toEqual(["e2"]);
  });

  it("names each record's kind, newest first, up to coreban's cap", () => {
    const many = Array.from({ length: MAX_SEARCH_RECORDS + 2 }, (_, i) =>
      entry({ id: `n${i}`, kind: i % 2 ? "income" : "expense", date: i < 2 ? "2020-01-01" : "2026-01-01" }),
    );
    const { records, total } = matchRecords("lunch", many, () => undefined, "2026-11-24");
    expect(total).toBe(MAX_SEARCH_RECORDS + 2);
    expect(records).toHaveLength(MAX_SEARCH_RECORDS);
    expect(records.some((r) => r.id === "n0" || r.id === "n1")).toBe(false);
    expect(records.find((r) => r.id === "n3")).toEqual({ kind: "income", id: "n3" });
  });
});

describe("searchSavedNotes", () => {
  const note = (over: Partial<Note>): Note => ({
    id: "n1",
    text: "",
    link: null,
    archived_at: null,
    posted_at: "2026-11-20T10:00:00Z",
    origin: "feed",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
    ...over,
  });
  const page = (...notes: Note[]): FeedData => ({ pages: [{ notes, older: null }], pageParams: [undefined] });
  const plain = note({ id: "plain", text: "Buy oat MILK", posted_at: "2026-11-21T00:00:00Z" });
  const reminder = note({
    id: "rem",
    link: { kind: "reminder", deleted: false, reminder: { message: "Call the plumber" } as KanbanReminder },
  });
  const card = note({ id: "card", link: { kind: "card", deleted: false, card: { title: "Fix milk crate" } as NoteCard } });
  const expense = note({ id: "exp", origin: "budget", link: { kind: "expense", deleted: false, record_id: "e1" } });
  const archived = note({ id: "old", text: "milk from last year", archived_at: "2026-11-22T00:00:00Z" });
  const saved = [page(plain, reminder), page(card, expense, archived, plain)];
  const ids = (q: string, opts: Partial<Parameters<typeof searchSavedNotes>[2]> = {}) =>
    searchSavedNotes(saved, q, { filter: "all", withArchived: false, records: [], ...opts }).map((n) => n.id);

  it("finds every word in a note's text, reminder or card, oldest first, each note once", () => {
    expect(ids("milk")).toEqual(["card", "plain"]);
    expect(ids("PLUMBER call")).toEqual(["rem"]);
    expect(ids("milk plumber")).toEqual([]);
    expect(ids("  ")).toEqual([]);
  });

  it("finds a budget note by the records matched on the device", () => {
    expect(ids("lunch", { records: [{ kind: "expense", id: "e1" }] })).toEqual(["exp"]);
    expect(ids("lunch", { records: [{ kind: "income", id: "e1" }] })).toEqual([]);
  });

  it("follows the Feed's filter and archive toggle", () => {
    expect(ids("milk", { filter: "budget" })).toEqual([]);
    expect(ids("lunch", { filter: "notes", records: [{ kind: "expense", id: "e1" }] })).toEqual([]);
    expect(ids("milk", { withArchived: true })).toEqual(["card", "old", "plain"]);
  });
});
