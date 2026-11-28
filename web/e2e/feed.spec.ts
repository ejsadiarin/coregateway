import type { Page } from "@playwright/test";

import { API_URL as api, expect, holdToConfirm, login, test } from "./fixtures";

// unique keeps notes from colliding with another test or an earlier run on
// the same stack.
const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });

async function post(page: Page, text: string) {
  await page.getByRole("textbox", { name: "New note" }).fill(text);
  await page.getByRole("textbox", { name: "New note" }).press("Enter");
  await expect(noteItem(page, text)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
}

async function noteAction(page: Page, text: string, action: string) {
  await noteItem(page, text).getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

// Archived notes are left out of the Feed unless asked for (coreban ADR-0006).
const toggleArchived = (page: Page) =>
  page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Archived" }).click();
const archivedRow = (page: Page, text: string) => noteItem(page, text).getByRole("button", { name: /Archived/ });

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto("/dashboard/feed");
  await expect(page.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
});

test("a posted note shows newest last, with its link tappable, and survives a reload", async ({ page }) => {
  const text = unique("read later");
  await post(page, `${text} https://example.com/article.`);

  const link = noteItem(page, text).getByRole("link", { name: "https://example.com/article" });
  await expect(link).toHaveAttribute("href", "https://example.com/article");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.reload();
  await expect(feed(page).getByRole("listitem").last()).toContainText(text);
  await noteAction(page, text, "Permanently delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(noteItem(page, text)).toHaveCount(0);
});

test("editing a note's text saves it", async ({ page }) => {
  const text = unique("buy milk");
  await post(page, text);
  await noteAction(page, text, "Edit text");
  const edited = `${text} and eggs`;
  await page.getByRole("textbox", { name: "Note text" }).fill(edited);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(noteItem(page, edited)).toBeVisible();

  await page.reload();
  await expect(noteItem(page, edited)).toBeVisible();
});

test("an archived note leaves the Feed; Archived shows it in its place, to restore or erase", async ({ page }) => {
  const text = unique("old thought");
  const after = unique("newer thought");
  await post(page, text);
  await post(page, after);

  await noteAction(page, text, "Archive");
  await expect(noteItem(page, text)).toHaveCount(0);
  await page.reload();
  await expect(noteItem(page, after)).toBeVisible();
  await expect(noteItem(page, text)).toHaveCount(0);

  // Shown on request, collapsed, still before the newer note.
  await toggleArchived(page);
  await expect(archivedRow(page, text)).toHaveAttribute("aria-expanded", "false");
  const items = await feed(page).getByRole("listitem").allTextContents();
  const at = items.findIndex((t) => t.includes(text));
  expect(items[at + 1]).toContain(after);

  await archivedRow(page, text).click();
  await noteItem(page, text).getByRole("button", { name: "Restore" }).click();
  await expect(noteItem(page, text).getByRole("button", { name: "Note actions" })).toBeVisible();
  await toggleArchived(page);
  await expect(noteItem(page, text).getByRole("button", { name: "Note actions" })).toBeVisible();

  await noteAction(page, text, "Archive");
  await toggleArchived(page);
  await archivedRow(page, text).click();
  await noteItem(page, text).getByRole("button", { name: "Permanently delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(noteItem(page, text)).toHaveCount(0);
  await page.reload();
  await toggleArchived(page);
  await expect(noteItem(page, after)).toBeVisible();
  await expect(noteItem(page, text)).toHaveCount(0);
});

test("a blank note can't be sent", async ({ page }) => {
  await page.getByRole("textbox", { name: "New note" }).fill("   ");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("+ Reminder captures a reminder from the chat box, shown live in the Feed", async ({ page }) => {
  const message = unique("call dentist");
  await page.getByRole("textbox", { name: "New note" }).fill(message);
  await page.getByRole("button", { name: "Reminder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New reminder" });
  await expect(dialog.getByRole("textbox", { name: "Message" })).toHaveValue(message);
  await dialog.getByLabel("When").fill("2030-03-05T07:00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
  await expect(noteItem(page, message)).toContainText("Tue 5 Mar 2030, 7:00 AM");

  // Editing it from the note changes it on the Reminders page.
  await noteItem(page, message).getByRole("button", { name: new RegExp(message) }).click();
  const editor = page.getByRole("dialog", { name: "Edit reminder" });
  await editor.getByRole("textbox", { name: "Message" }).fill(`${message} back`);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await page.goto("/dashboard/kanban/reminders");
  await expect(page.getByRole("main").getByText(`${message} back`, { exact: true })).toBeVisible();

  // Archiving its note deletes the reminder, after naming it.
  await page.goto("/dashboard/feed");
  await noteAction(page, `${message} back`, "Archive");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`delete its reminder “${message} back”`);
  await confirm.getByRole("button", { name: "Archive" }).click();
  await expect(noteItem(page, `${message} back`)).toHaveCount(0);
  await toggleArchived(page);
  await archivedRow(page, `${message} back`).click();
  await expect(noteItem(page, `${message} back`)).toContainText(`${message} back (deleted)`);
  await page.goto("/dashboard/kanban/reminders");
  await expect(page.getByRole("main").getByText(`${message} back`, { exact: true })).toHaveCount(0);
});

test("Make card converts a note in place; archiving it archives the card and Restore brings it back", async ({ page }) => {
  const board = `Feed ${Date.now().toString(36)}`;
  await page.goto("/dashboard/kanban");
  await page.getByLabel("New board").fill(board);
  await page.getByRole("main").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("main").getByText(board, { exact: true })).toBeVisible();

  await page.goto("/dashboard/feed");
  const title = unique("fix NAS backup");
  await post(page, title);
  await noteAction(page, title, "Make card");
  const dialog = page.getByRole("dialog", { name: "New card" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await dialog.getByRole("combobox", { name: "Board" }).click();
  await page.getByRole("option", { name: board }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(noteItem(page, title)).toContainText(`${board} · Todo`);

  await noteAction(page, title, "Archive");
  await expect(page.getByRole("alertdialog")).toContainText(`archive its card “${title}”`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
  await expect(noteItem(page, title)).toHaveCount(0);

  await page.goto("/dashboard/kanban");
  await page.getByRole("main").getByText(board, { exact: true }).click();
  await expect(page.getByRole("main").getByText(title, { exact: true })).toHaveCount(0);

  await page.goto("/dashboard/feed");
  await toggleArchived(page);
  await archivedRow(page, title).click();
  await noteItem(page, title).getByRole("button", { name: "Restore" }).click();
  await noteItem(page, title).getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("dialog", { name: "Edit card" })).toBeVisible();

  // Deleting the card on its board leaves the note showing it, deleted.
  await page.getByRole("dialog", { name: "Edit card" }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await page.goto("/dashboard/feed");
  await expect(noteItem(page, title)).toContainText(`${title} (deleted)`);

  await page.goto("/dashboard/kanban");
  await page.getByRole("button", { name: `Delete ${board}` }).click();
  await holdToConfirm(page, page.getByRole("alertdialog").getByRole("button", { name: "Hold to delete" }));
});

test("on a desktop keyboard Enter posts and Shift+Enter breaks the line", async ({ page }) => {
  const first = unique("groceries");
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(first);
  await box.press("Shift+Enter");
  await box.pressSequentially("eggs");
  await expect(box).toHaveValue(`${first}\neggs`);
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(noteItem(page, first)).toContainText(`${first}\neggs`, { useInnerText: true });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Enter makes a new line in a note and its edit; Send and Save post them", async ({ page }) => {
    // isMobile + hasTouch are what make Chromium report a touch device.
    expect(await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches)).toBe(true);
    // Every write to the Feed, so a wrongly sent Enter shows up here
    // rather than racing the assertions on what's on screen.
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/coreban/notes") && r.method() !== "GET") writes.push(r.method());
    });

    const first = unique("packing list");
    const box = page.getByRole("textbox", { name: "New note" });
    await expect(box).toHaveAttribute("enterkeyhint", "enter");
    await box.fill(first);
    await box.press("Enter");
    await box.pressSequentially("charger");
    await expect(box).toHaveValue(`${first}\ncharger`);
    expect(writes).toEqual([]);

    await page.getByRole("main").getByRole("button", { name: "Send", exact: true }).click();
    await expect(box).toHaveValue("");
    const note = noteItem(page, first);
    await expect(note).toContainText(`${first}\ncharger`, { useInnerText: true });

    await noteAction(page, first, "Edit text");
    const editor = page.getByRole("textbox", { name: "Note text" });
    await editor.press("Control+End");
    await editor.press("Enter");
    await editor.pressSequentially("passport");
    expect(writes).toEqual(["POST"]);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(note).toContainText(`${first}\ncharger\npassport`, { useInnerText: true });
    expect(writes).toEqual(["POST", "PATCH"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});

// A reply answers an earlier note and shows it as a quote, like a chat
// app's reply (coreban CONTEXT "Reply").
const quoteIn = (page: Page, text: string) => noteItem(page, text).getByRole("figure", { name: "Replying to" });
const replyBar = (page: Page) => page.getByRole("region", { name: "Replying to" });
// A reply's quote holds its original's text too; the original, posted
// first, is the first match.
const replyTo = async (page: Page, text: string, action = "Reply") => {
  await noteItem(page, text).first().getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: action }).click();
};

test("replying from a note's menu quotes it above the reply, live, after a reload", async ({ page }) => {
  const original = unique("dinner at 7?");
  const answer = unique("make it 8");
  await post(page, original);

  await replyTo(page, original, "Reply");
  await expect(replyBar(page)).toContainText(original);
  await expect(page.getByRole("textbox", { name: "New note" })).toBeFocused();
  await post(page, answer);
  await expect(replyBar(page)).toHaveCount(0);
  await expect(quoteIn(page, answer)).toContainText(original);

  // The quote shows the original as it is now.
  await replyTo(page, original, "Edit text");
  const edited = `${original} or 7:30`;
  await page.getByRole("textbox", { name: "Note text" }).fill(edited);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(quoteIn(page, answer)).toContainText(edited);
  await page.reload();
  await expect(quoteIn(page, answer)).toContainText(edited);
});

test("a reply can be cancelled with the bar's close button or Esc", async ({ page }) => {
  const original = unique("never mind");
  await post(page, original);

  await replyTo(page, original, "Reply");
  await replyBar(page).getByRole("button", { name: "Cancel reply" }).click();
  await expect(replyBar(page)).toHaveCount(0);

  await replyTo(page, original, "Reply");
  await page.getByRole("textbox", { name: "New note" }).press("Escape");
  await expect(replyBar(page)).toHaveCount(0);

  const plain = unique("just a note");
  await post(page, plain);
  await expect(quoteIn(page, plain)).toHaveCount(0);
});

test("an archived original stays quoted, tagged archived; a deleted one reads Note deleted", async ({ page }) => {
  const kept = unique("put away later");
  const gone = unique("erase later");
  const toKept = unique("about the kept one");
  const toGone = unique("about the erased one");
  await post(page, kept);
  await post(page, gone);
  await replyTo(page, kept, "Reply");
  await post(page, toKept);
  await replyTo(page, gone, "Reply");
  await post(page, toGone);

  await replyTo(page, kept, "Archive");
  await expect(quoteIn(page, toKept)).toContainText(kept);
  await expect(quoteIn(page, toKept)).toContainText("Archived");

  await replyTo(page, gone, "Permanently delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(quoteIn(page, toGone)).toContainText("Note deleted");
  await expect(quoteIn(page, toGone)).not.toContainText(gone);

  await page.reload();
  await expect(quoteIn(page, toKept)).toContainText("Archived");
  await expect(quoteIn(page, toGone)).toContainText("Note deleted");
});

// coregateway#78: on a phone, swiping a note left starts a reply, like a
// chat app; with a mouse, hovering a note shows a reply button.
test.describe("swipe to reply", () => {
  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    // A phone's Enter types a line break; Send posts.
    async function postOnPhone(page: Page, text: string) {
      await page.getByRole("textbox", { name: "New note" }).fill(text);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(noteItem(page, text)).toBeVisible();
    }

    // swipe drags a finger across the note's bubble by dx, dy, in steps.
    async function swipe(page: Page, text: string, dx: number, dy = 0) {
      const box = await noteItem(page, text).first().getByText(text).first().boundingBox();
      if (!box) throw new Error(`no bubble for ${text}`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
      await touch("touchStart", [{ x, y }]);
      for (let i = 1; i <= 12; i++) {
        await touch("touchMove", [{ x: x + (dx * i) / 12, y: y + (dy * i) / 12 }]);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd", []);
      await cdp.detach();
    }

    test("a swipe left past the mark starts a reply; a short one doesn't", async ({ page }) => {
      const text = unique("swipe me");
      await postOnPhone(page, text);

      await swipe(page, text, -30);
      await expect(replyBar(page)).toHaveCount(0);

      await swipe(page, text, -150);
      await expect(replyBar(page)).toContainText(text);
      // The bubble springs back into place.
      await expect
        .poll(() => noteItem(page, text).first().locator("[data-swipe]").evaluate((el) => getComputedStyle(el).transform))
        .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

      const answer = unique("swiped reply");
      await page.getByRole("textbox", { name: "New note" }).fill(answer);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(quoteIn(page, answer)).toContainText(text);
    });

    test("a mostly vertical drag or a swipe right doesn't start a reply", async ({ page }) => {
      const text = unique("scroll past me");
      await postOnPhone(page, text);
      await swipe(page, text, -60, -200);
      await swipe(page, text, 150);
      await expect(replyBar(page)).toHaveCount(0);
    });
  });

  test("with a mouse, hovering a note shows a Reply button", async ({ page }) => {
    const text = unique("hover me");
    await post(page, text);
    const button = noteItem(page, text).getByRole("button", { name: "Reply", exact: true });
    await noteItem(page, text).hover();
    await expect(button).toBeVisible();
    await button.click();
    await expect(replyBar(page)).toContainText(text);
  });
});

// coregateway#79: tapping a reply's quote goes to the note it quotes and
// flashes it, loading older pages, the Feed as a whole, or archived notes
// as needed.
test.describe("jump to the quoted note", () => {
  const goTo = (page: Page, reply: string) =>
    quoteIn(page, reply).getByRole("button", { name: "Go to the quoted note" }).click();
  const original = (page: Page, text: string) => noteItem(page, text).first();
  const postApi = async (page: Page, text: string, replyTo?: string) => {
    const res = await page.request.post(`${api}/api/coreban/notes`, {
      data: replyTo ? { text, reply_to: replyTo } : { text },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()).id as string;
  };

  test("a quote whose note is on screen scrolls to it and flashes it", async ({ page }) => {
    const text = unique("jump target");
    const answer = unique("jump from");
    await post(page, text);
    await replyTo(page, text);
    await post(page, answer);

    await goTo(page, answer);
    await expect(original(page, text)).toHaveClass(/feed-landed/);
    await expect(original(page, text)).toBeInViewport();
  });

  test("a quote whose note is pages back loads them and lands on it", async ({ page }) => {
    const text = unique("long ago");
    const id = await postApi(page, text);
    for (let i = 0; i < 60; i++) await postApi(page, unique(`filler ${i}`));
    const answer = unique("about long ago");
    await postApi(page, answer, id);
    await page.reload();
    await expect(noteItem(page, answer)).toBeVisible();
    await expect(noteItem(page, text)).toHaveCount(1); // only the quote

    await goTo(page, answer);
    await expect(original(page, text)).toHaveClass(/feed-landed/);
    await expect(original(page, text)).toBeInViewport();
  });

  test("from a search, the jump goes back to the whole Feed", async ({ page }) => {
    const text = unique("searched target");
    const answer = unique("searchable reply");
    await post(page, text);
    await replyTo(page, text);
    await post(page, answer);

    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search the Feed" }).fill(answer.split(" ").at(-1)!);
    await expect(noteItem(page, answer)).toBeVisible();
    await expect(feed(page).getByRole("listitem")).toHaveCount(1);

    await goTo(page, answer);
    await expect(page.getByRole("searchbox", { name: "Search the Feed" })).toHaveCount(0);
    await expect(original(page, text)).toHaveClass(/feed-landed/);
  });

  test("an archived quote shows archived notes and lands on it; a deleted one isn't a link", async ({ page }) => {
    const kept = unique("archived target");
    const gone = unique("deleted target");
    const toKept = unique("to the archived");
    const toGone = unique("to the deleted");
    await post(page, kept);
    await post(page, gone);
    await replyTo(page, kept);
    await post(page, toKept);
    await replyTo(page, gone);
    await post(page, toGone);
    await replyTo(page, kept, "Archive");
    await replyTo(page, gone, "Permanently delete");
    await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();

    await expect(quoteIn(page, toGone)).toContainText("Note deleted");
    await expect(quoteIn(page, toGone).getByRole("button")).toHaveCount(0);

    await goTo(page, toKept);
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Archived" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(original(page, kept)).toHaveClass(/feed-landed/);
    await expect(archivedRow(page, kept)).toBeInViewport();
  });
});
