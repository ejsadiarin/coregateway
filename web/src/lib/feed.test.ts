import { describe, expect, it } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";
import {
  appendNote,
  archivePrompt,
  enterSends,
  feedNotes,
  linkSummary,
  noteCopyText,
  noteTime,
  removeNote,
  replaceNote,
  splitLinks,
} from "./feed";
import type { FeedPage, Note, NoteCard, NoteLink } from "@/types/feed";
import type { KanbanReminder } from "@/types/kanban";
import type { Expense, Income } from "@/types/api";

const note = (id: string, text = id): Note => ({
  id,
  text,
  link: null,
  archived_at: null,
  created_at: "2026-11-11T10:00:00Z",
  updated_at: "2026-11-11T10:00:00Z",
});

// pages[0] is the newest page; each later page goes further back in time.
const feed = (...pages: string[][]): InfiniteData<FeedPage, string | undefined> => ({
  pages: pages.map((ids) => ({ notes: ids.map((id) => note(id)), older: null })),
  pageParams: pages.map((_, i) => (i === 0 ? undefined : `c${i}`)),
});

describe("feedNotes", () => {
  it("reads the pages back as one feed, oldest first", () => {
    expect(feedNotes(feed(["d", "e"], ["b", "c"], ["a"])).map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("shows a note only once if a refetch moved it across a page boundary", () => {
    expect(feedNotes(feed(["c", "d"], ["b", "c"])).map((n) => n.id)).toEqual(["b", "c", "d"]);
  });

  it("is empty before the first page loads", () => {
    expect(feedNotes(undefined)).toEqual([]);
  });
});

describe("cache updates", () => {
  it("appends a posted note to the end of the newest page", () => {
    const next = appendNote(feed(["b"], ["a"]), note("c"));
    expect(feedNotes(next).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces an edited or archived note in place", () => {
    const edited = { ...note("b", "changed"), archived_at: "2026-11-11T11:00:00Z" };
    const next = replaceNote(feed(["c"], ["a", "b"]), edited);
    expect(feedNotes(next).map((n) => [n.id, n.text, n.archived_at])).toEqual([
      ["a", "a", null],
      ["b", "changed", "2026-11-11T11:00:00Z"],
      ["c", "c", null],
    ]);
  });

  it("removes a permanently deleted note from every page", () => {
    const next = removeNote(feed(["b", "c"], ["a", "b"]), "b");
    expect(feedNotes(next).map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("leaves an unloaded feed alone", () => {
    expect(appendNote(undefined, note("a"))).toBeUndefined();
    expect(replaceNote(undefined, note("a"))).toBeUndefined();
    expect(removeNote(undefined, "a")).toBeUndefined();
  });
});

describe("splitLinks", () => {
  it("leaves plain text as one piece", () => {
    expect(splitLinks("buy milk")).toEqual([{ text: "buy milk" }]);
  });

  it("finds http and https links among text", () => {
    expect(splitLinks("read https://example.com/a?b=1#c then http://x.io")).toEqual([
      { text: "read " },
      { text: "https://example.com/a?b=1#c", href: "https://example.com/a?b=1#c" },
      { text: " then " },
      { text: "http://x.io", href: "http://x.io" },
    ]);
  });

  it("links a bare www address over https", () => {
    expect(splitLinks("www.example.com")).toEqual([{ text: "www.example.com", href: "https://www.example.com" }]);
  });

  it("keeps sentence punctuation and wrapping brackets out of the link", () => {
    expect(splitLinks("see (https://example.com/x). ok?")).toEqual([
      { text: "see (" },
      { text: "https://example.com/x", href: "https://example.com/x" },
      { text: "). ok?" },
    ]);
    expect(splitLinks("https://en.wikipedia.org/wiki/Go_(programming_language),")).toEqual([
      {
        text: "https://en.wikipedia.org/wiki/Go_(programming_language)",
        href: "https://en.wikipedia.org/wiki/Go_(programming_language)",
      },
      { text: "," },
    ]);
  });

  it("never links other schemes", () => {
    expect(splitLinks("javascript:alert(1) ftp://x")).toEqual([{ text: "javascript:alert(1) ftp://x" }]);
  });

  it("keeps line breaks in the text around links", () => {
    expect(splitLinks("a\nhttps://x.io\nb")).toEqual([
      { text: "a\n" },
      { text: "https://x.io", href: "https://x.io" },
      { text: "\nb" },
    ]);
  });
});

describe("noteTime", () => {
  const now = new Date(2026, 10, 11, 18, 0);

  it("shows only the time for a note posted today", () => {
    expect(noteTime(new Date(2026, 10, 11, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("adds the day for an older note", () => {
    expect(noteTime(new Date(2026, 10, 9, 21, 30).toISOString(), now)).toBe("Mon 9 Nov, 21:30");
  });

  it("adds the year for a note from another year", () => {
    expect(noteTime(new Date(2025, 0, 2, 7, 0).toISOString(), now)).toBe("Thu 2 Jan 2025, 07:00");
  });
});

const reminder: KanbanReminder = {
  id: "r1",
  message: "call dentist",
  schedule: { kind: "once", at: "2026-11-17T07:00:00+08:00" },
  next_fire_at: "2026-11-17T07:00:00+08:00",
  paused: null,
  last_delivery: null,
  card: null,
  created_at: "2026-11-11T10:00:00+08:00",
  updated_at: "2026-11-11T10:00:00+08:00",
};

const card: NoteCard = {
  id: "c1",
  board_id: "b1",
  board_name: "Homelab",
  column_name: "Doing",
  status: "in_progress",
  title: "fix NAS backup",
  archived_at: null,
};

const linked = (link: NoteLink, archived = false): Note => ({
  ...note("n"),
  text: "",
  link,
  archived_at: archived ? "2026-11-12T10:00:00Z" : null,
});

describe("linkSummary", () => {
  it("names a reminder and when it fires next, in the owner's own wall time", () => {
    expect(linkSummary({ kind: "reminder", deleted: false, reminder }, 2026)).toEqual({
      title: "call dentist",
      detail: "Tue 17 Nov, 07:00",
    });
  });

  it("says how a recurring reminder repeats once nothing is left to send", () => {
    const daily = { ...reminder, schedule: { kind: "daily" as const, time: "07:00" }, next_fire_at: null };
    expect(linkSummary({ kind: "reminder", deleted: false, reminder: daily }, 2026).detail).toBe("Daily at 07:00");
  });

  it("names a card with its board, column, and status", () => {
    expect(linkSummary({ kind: "card", deleted: false, card }, 2026)).toEqual({
      title: "fix NAS backup",
      detail: "Homelab · Doing · In progress",
    });
    expect(linkSummary({ kind: "card", deleted: false, card: { ...card, archived_at: "2026-11-12T00:00:00Z" } }, 2026).detail).toBe(
      "Homelab · Doing · In progress · archived",
    );
  });

  it("says a card's status once when its column is named after it", () => {
    const todo = { ...card, column_name: "Todo", status: "todo" as const };
    expect(linkSummary({ kind: "card", deleted: false, card: todo }, 2026).detail).toBe("Homelab · Todo");
  });

  it("marks a deleted record, even one that left nothing behind", () => {
    expect(linkSummary({ kind: "card", deleted: true, card }, 2026).title).toBe("fix NAS backup (deleted)");
    expect(linkSummary({ kind: "reminder", deleted: true }, 2026)).toEqual({ title: "Reminder (deleted)", detail: "" });
  });
});

describe("archivePrompt", () => {
  it("names the reminder that archiving its note deletes", () => {
    expect(archivePrompt(linked({ kind: "reminder", deleted: false, reminder }))).toBe(
      "Archive this note and delete its reminder “call dentist”? The reminder can't be brought back.",
    );
  });

  it("names the card that archiving its note archives", () => {
    expect(archivePrompt(linked({ kind: "card", deleted: false, card }))).toBe(
      "Archive this note and archive its card “fix NAS backup”? Restore the note to bring the card back.",
    );
  });

  it("asks nothing when only the note changes", () => {
    expect(archivePrompt(note("plain"))).toBeNull();
    expect(archivePrompt(linked({ kind: "reminder", deleted: true, reminder }))).toBeNull();
    expect(archivePrompt(linked({ kind: "card", deleted: false, card: { ...card, archived_at: "2026-11-12T00:00:00Z" } }))).toBeNull();
  });
});

describe("noteCopyText", () => {
  it("copies a plain note's text, and a linked note's summary", () => {
    expect(noteCopyText(note("a", "buy milk"), 2026)).toBe("buy milk");
    expect(noteCopyText(linked({ kind: "card", deleted: false, card }), 2026)).toBe("fix NAS backup · Homelab · Doing · In progress");
  });
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
  amount: "20000.00" as unknown as number,
  currency: "PHP",
  date: "2026-11-15",
  recurring_type: "monthly",
  priority: "need",
  status: "posted",
  created_at: "2026-11-12T04:00:00Z",
  updated_at: "2026-11-12T04:00:00Z",
};

const expenseNote = (id: string, recordId: string, deleted = false, expense?: Expense): Note =>
  linked({ kind: "expense", deleted, record_id: recordId, expense });

const category = (id: string) => (id === "food" ? "Food" : undefined);

describe("linkSummary for budget records", () => {
  it("shows an expense's amount and description, then its category and day", () => {
    expect(linkSummary({ kind: "expense", deleted: false, record_id: "e1", expense: lunch }, 2026, category)).toEqual({
      title: "₱250.00 · Lunch",
      detail: "Food · Thu 12 Nov",
    });
  });

  it("shows how a recurring income repeats, and amounts corefinance sends as text", () => {
    expect(linkSummary({ kind: "income", deleted: false, record_id: "i1", income: salary }, 2026)).toEqual({
      title: "₱20,000.00 · Salary",
      detail: "Sun 15 Nov · monthly",
    });
  });

  it("names the kind until the record loads, and marks a deleted one", () => {
    expect(linkSummary({ kind: "expense", deleted: false, record_id: "e1" }, 2026)).toEqual({ title: "Expense", detail: "" });
    expect(linkSummary({ kind: "income", deleted: true, record_id: "i1" }, 2026).title).toBe("Income (deleted)");
    expect(linkSummary({ kind: "expense", deleted: true, record_id: "e1", expense: lunch }, 2026).title).toBe(
      "₱250.00 · Lunch (deleted)",
    );
  });
});




describe("archivePrompt for budget records", () => {
  it("names the expense or income that archiving its note deletes for good", () => {
    expect(archivePrompt(expenseNote("n", "e1", false, lunch))).toBe(
      "Archive this note and delete its expense “Lunch” (₱250.00)? The expense can't be brought back.",
    );
    expect(archivePrompt(linked({ kind: "income", deleted: false, record_id: "i1" }))).toBe(
      "Archive this note and delete its income? The income can't be brought back.",
    );
    expect(archivePrompt(expenseNote("n", "e1", true, lunch))).toBeNull();
  });
});

describe("enterSends", () => {
  const enter = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13 };

  it("sends on Enter from a desktop keyboard, but not Shift+Enter or mid-composition", () => {
    expect(enterSends(enter, false)).toBe(true);
    expect(enterSends({ ...enter, shiftKey: true }, false)).toBe(false);
    expect(enterSends({ ...enter, isComposing: true }, false)).toBe(false);
  });

  it("never sends on a plain Enter from a touch device: Enter is a line break there", () => {
    expect(enterSends(enter, true)).toBe(false);
  });

  it("sends on Ctrl+Enter or Cmd+Enter anywhere, for a hardware keyboard on a tablet", () => {
    expect(enterSends({ ...enter, ctrlKey: true }, true)).toBe(true);
    expect(enterSends({ ...enter, metaKey: true }, true)).toBe(true);
    expect(enterSends({ ...enter, metaKey: true }, false)).toBe(true);
  });

  it("doesn't send the Enter that confirms an IME word in Safari (keyCode 229)", () => {
    expect(enterSends({ ...enter, keyCode: 229 }, false)).toBe(false);
    expect(enterSends({ ...enter, ctrlKey: true, isComposing: true }, true)).toBe(false);
  });

  it("ignores every other key", () => {
    expect(enterSends({ ...enter, key: "a" }, false)).toBe(false);
  });
});
