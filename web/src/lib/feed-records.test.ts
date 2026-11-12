import { describe, expect, it } from "vitest";
import { budgetRecordIds, rememberShown, showBudget } from "./feed-records";
import type { Note, NoteLink } from "@/types/feed";
import type { Expense, Income } from "@/types/api";

const note = (id: string, link: NoteLink | null = null): Note => ({
  id,
  text: link ? "" : id,
  link,
  archived_at: null,
  created_at: "2026-11-11T10:00:00Z",
  updated_at: "2026-11-11T10:00:00Z",
});

const lunch: Expense = {
  id: "e1",
  description: "Lunch",
  amount: 250,
  currency: "PHP",
  category_id: "food",
  expense_date: "2026-11-12",
  recurring_type: "one-time",
  priority: "need",
  status: "posted",
  is_debt: false,
  created_at: "2026-11-12T04:00:00Z",
  updated_at: "2026-11-12T04:00:00Z",
};

const salary: Income = {
  id: "i1",
  description: "Salary",
  amount: 20000,
  currency: "PHP",
  date: "2026-11-15",
  recurring_type: "monthly",
  priority: "need",
  status: "posted",
  created_at: "2026-11-12T04:00:00Z",
  updated_at: "2026-11-12T04:00:00Z",
};

const expenseNote = (id: string, recordId: string, deleted = false, expense?: Expense): Note =>
  note(id, { kind: "expense", deleted, record_id: recordId, expense });
const linked = (link: NoteLink) => note("n", link);
const withId = (n: Note, id: string): Note => ({ ...n, id });
const card = {
  id: "c1",
  board_id: "b1",
  board_name: "Homelab",
  column_name: "Doing",
  status: "in_progress" as const,
  title: "fix NAS backup",
  archived_at: null,
};

describe("budgetRecordIds", () => {
  it("asks corefinance only for records not known to be gone", () => {
    const notes = [
      note("plain"),
      withId(expenseNote("n", "e1"), "n1"),
      withId(expenseNote("n", "e2", true), "n2"),
      withId(linked({ kind: "income", deleted: false, record_id: "i1" }), "n3"),
      withId(linked({ kind: "card", deleted: false, card }), "n4"),
    ];
    expect(budgetRecordIds(notes)).toEqual({ expense: ["e1"], income: ["i1"] });
  });
});

describe("showBudget", () => {
  const records = {
    asked: new Set(["e1", "e2", "i1"]),
    expense: new Map([["e1", lunch]]),
    income: new Map<string, Income>(),
  };

  it("shows a record corefinance returned, live", () => {
    const shown = showBudget(expenseNote("n", "e1"), records, {});
    expect(shown.note.link).toEqual({ kind: "expense", deleted: false, record_id: "e1", expense: lunch });
    expect(shown.snapshot).toBeUndefined();
  });

  it("reads a record it asked for and didn't get as deleted, with what it last showed as the snapshot", () => {
    const last = { ...lunch, id: "e2", description: "Dinner" };
    const shown = showBudget(expenseNote("n", "e2"), records, { e2: { kind: "expense", record: last } });
    expect(shown.note.link).toEqual({ kind: "expense", deleted: true, record_id: "e2", expense: last });
    expect(shown.snapshot).toEqual(last);
  });

  it("marks a missing record deleted even with nothing to show for it", () => {
    const shown = showBudget(linked({ kind: "income", deleted: false, record_id: "i1" }), records, {});
    expect(shown.note.link).toEqual({ kind: "income", deleted: true, record_id: "i1" });
    expect(shown.snapshot).toBeUndefined();
  });

  it("leaves a note alone while its record hasn't been asked for, or once coreban knows it's gone", () => {
    const pending = expenseNote("n", "e9");
    expect(showBudget(pending, records, {}).note).toBe(pending);
    const gone = expenseNote("n", "e2", true, lunch);
    expect(showBudget(gone, records, { e2: { kind: "expense", record: salary as never } }).note).toBe(gone);
    expect(showBudget(note("plain"), records, {}).note.link).toBeNull();
  });
});

describe("rememberShown", () => {
  it("keeps the newest content shown for each record, up to a cap", () => {
    let shown = rememberShown({}, [{ kind: "expense", record: lunch }], 2);
    shown = rememberShown(shown, [{ kind: "income", record: salary }], 2);
    const later = { ...lunch, description: "Late lunch" };
    shown = rememberShown(shown, [{ kind: "expense", record: later }], 2);
    expect(shown.e1.record).toEqual(later);
    shown = rememberShown(shown, [{ kind: "expense", record: { ...lunch, id: "e3" } }], 2);
    expect(Object.keys(shown).sort()).toEqual(["e1", "e3"]);
  });
});
