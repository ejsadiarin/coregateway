import { describe, expect, it } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";
import { appendNote, feedNotes, noteTime, removeNote, replaceNote, splitLinks } from "./feed";
import type { FeedPage, Note } from "@/types/feed";

const note = (id: string, text = id): Note => ({
  id,
  text,
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
