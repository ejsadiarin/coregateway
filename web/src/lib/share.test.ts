import { describe, expect, it } from "vitest";
import { MAX_NOTE_LENGTH } from "./feed";
import { safeReturnPath, sharedNoteText } from "./share";

describe("sharedNoteText", () => {
  it("joins a shared title, text and URL into one note, one per line", () => {
    expect(
      sharedNoteText({ title: "Gateway API", text: "worth a read", url: "https://example.com/gw" }),
    ).toBe("Gateway API\nworth a read\nhttps://example.com/gw");
  });

  it("keeps a page Chrome shares as its title and the URL in text", () => {
    expect(sharedNoteText({ title: "Gateway API", text: "https://example.com/gw", url: "" })).toBe(
      "Gateway API\nhttps://example.com/gw",
    );
  });

  it("drops a part another part already holds", () => {
    expect(
      sharedNoteText({ title: "", text: "look https://youtu.be/x1", url: "https://youtu.be/x1" }),
    ).toBe("look https://youtu.be/x1");
    expect(sharedNoteText({ title: "Lunch idea", text: "Lunch idea", url: null })).toBe("Lunch idea");
  });

  it("trims each part and skips the blank ones", () => {
    expect(sharedNoteText({ title: "  ", text: "  buy rice \n", url: null })).toBe("buy rice");
  });

  it("keeps a short part that only appears inside a longer one", () => {
    expect(sharedNoteText({ title: "AI", text: "Thoughts on AI safety", url: null })).toBe(
      "AI\nThoughts on AI safety",
    );
    expect(sharedNoteText({ title: "", text: "see https://x.com/ab", url: "https://x.com/a" })).toBe(
      "see https://x.com/ab\nhttps://x.com/a",
    );
  });

  it("is null when nothing was shared", () => {
    expect(sharedNoteText({ title: null, text: " ", url: "" })).toBeNull();
  });

  it("shortens long shared text to fit a note, keeping the URL whole", () => {
    const url = "https://example.com/article";
    const got = sharedNoteText({ title: "", text: "x".repeat(MAX_NOTE_LENGTH), url })!;
    expect(got).toHaveLength(MAX_NOTE_LENGTH);
    expect(got.endsWith(`…\n${url}`)).toBe(true);
  });
});

describe("sharedNoteText, cut to fit", () => {
  it("never goes over a note's limit, even for a link longer than it", () => {
    const url = `https://example.com/${"a".repeat(MAX_NOTE_LENGTH)}`;
    expect(sharedNoteText({ title: "Long", text: null, url })!.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
  });

  it("doesn't split an emoji where it cuts", () => {
    const got = sharedNoteText({ title: "", text: "x".repeat(MAX_NOTE_LENGTH - 4) + "😀".repeat(10), url: null })!;
    expect(got.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    expect(got).toMatch(/^[^\uD800-\uDFFF]*(?:[\uD800-\uDBFF][\uDC00-\uDFFF][^\uD800-\uDFFF]*)*$/);
  });
});

describe("safeReturnPath", () => {
  it("returns a path within the app", () => {
    expect(safeReturnPath("/share?text=hi")).toBe("/share?text=hi");
  });

  it("falls back to the dashboard for anything else", () => {
    for (const bad of [undefined, null, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", 42]) {
      expect(safeReturnPath(bad)).toBe("/dashboard");
    }
  });
});
