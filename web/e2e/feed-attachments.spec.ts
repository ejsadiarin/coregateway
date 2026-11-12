import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";

import { API_URL, expect, login, test } from "./fixtures";

// Attachments go straight from the browser to the local S3 bucket that
// scripts/e2e-up.sh runs on :19070, beside the gateway.

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });
const tray = (page: Page) => page.getByRole("list", { name: "Attachments to send" });
const send = (page: Page) => page.getByRole("button", { name: "Send" });

// png makes a real width × height PNG, a different colour per seed, so
// the browser has something to decode and re-encode.
function png(width: number, height: number, seed = 0): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([(seed * 40 + x) & 0xff, (seed * 90) & 0xff, (x * 2) & 0xff], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const image = (name: string, seed = 0) => ({ name, mimeType: "image/png", buffer: png(120, 80, seed) });
const clip = { name: "clip.webm", mimeType: "video/webm", buffer: readFileSync(new URL("./assets/clip.webm", import.meta.url)) };

async function attach(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images or videos" }).click();
  await (await chooser).setFiles(files);
}

// postAttached attaches files, waits for every upload, and posts them
// with caption.
async function postAttached(page: Page, caption: string, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await attach(page, files);
  await expect(tray(page).getByText("Uploaded")).toHaveCount(files.length, { timeout: 20_000 });
  await page.getByRole("textbox", { name: "New note" }).fill(caption);
  await send(page).click();
  await expect(noteItem(page, caption)).toBeVisible();
  await expect(tray(page)).toHaveCount(0);
}

async function erase(page: Page, note: Locator) {
  await note.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: "Permanently delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
  await expect(note).toHaveCount(0);
}

test.describe("as the owner", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/dashboard/feed");
    await expect(page.getByRole("heading", { level: 1, name: "Feed" })).toBeVisible();
  });

  test("an image is stored as WebP, shows with its caption, opens full screen, and downloads", async ({ page }) => {
    const caption = unique("sunset");
    await postAttached(page, caption, [image("sunset.png")]);
    const note = noteItem(page, caption);
    const thumb = note.getByRole("button", { name: "Open image 1 of 1" });
    await expect(thumb.locator("img")).toHaveJSProperty("complete", true);

    // What the bucket holds is WebP, whatever was picked.
    const src = await thumb.locator("img").getAttribute("src");
    const stored = await (await page.request.get(src!)).body();
    expect(stored.subarray(0, 4).toString()).toBe("RIFF");
    expect(stored.subarray(8, 12).toString()).toBe("WEBP");

    // Still there from a fresh load, with fresh links.
    await page.reload();
    await thumb.click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByRole("img", { name: "Image 1 of 1" })).toBeVisible();
    const saved = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Download" }).click();
    expect((await saved).suggestedFilename()).toMatch(/^coreban-\d{8}-[0-9a-f]{8}\.webp$/);
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toHaveCount(0);

    // It stays a plain note: no reminder or card from it, and Copy copies
    // the caption.
    await note.getByRole("button", { name: "Note actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit caption" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Make (reminder|card)/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await erase(page, note);
  });

  test("a video goes up with a poster frame and plays in the viewer", async ({ page }) => {
    const caption = unique("clip");
    await postAttached(page, caption, [clip]);
    const note = noteItem(page, caption);
    const thumb = note.getByRole("button", { name: "Open video 1 of 1" });
    await expect(thumb.locator("img")).toHaveAttribute("src", /\.poster\?/);

    await thumb.click();
    const video = page.getByRole("dialog").locator("video");
    await expect(video).toHaveAttribute("src", /[0-9a-f-]{36}\?/);
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
      return v.play();
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    await erase(page, note);
  });

  test("ten attachments make an album, in the order picked, and the picker stops at ten", async ({ page }) => {
    const caption = unique("album");
    const files = Array.from({ length: 10 }, (_, i) => image(`p${i}.png`, i));
    await attach(page, files);
    await expect(page.getByRole("button", { name: "Attach images or videos" })).toBeDisabled();
    await expect(tray(page).getByText("Uploaded")).toHaveCount(10, { timeout: 30_000 });
    await page.getByRole("textbox", { name: "New note" }).fill(caption);
    await send(page).click();

    const note = noteItem(page, caption);
    await expect(note.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveCount(10);

    // Swiping on in the viewer walks the album to its end.
    await note.getByRole("button", { name: "Open image 9 of 10" }).click();
    const viewer = page.getByRole("dialog");
    await viewer.getByRole("button", { name: "Next" }).click();
    await expect(viewer.getByRole("img", { name: "Image 10 of 10" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.keyboard.press("Escape");

    await erase(page, note);
  });

  test("a failed upload can be retried, and the note waits for it", async ({ page }) => {
    let failed = false;
    const bucket = new URL(API_URL.replace(/:\d+$/, ":19070")).origin;
    await page.route(`${bucket}/**`, (route) => {
      if (route.request().method() === "PUT" && !failed) {
        failed = true;
        return route.abort("failed");
      }
      return route.continue();
    });

    const caption = unique("retry");
    await attach(page, [image("flaky.png")]);
    const item = tray(page).getByRole("listitem", { name: "flaky.png" });
    await expect(item.getByRole("alert")).toContainText("Upload failed");
    await page.getByRole("textbox", { name: "New note" }).fill(caption);
    await expect(send(page)).toBeDisabled();

    await item.getByRole("button", { name: "Retry flaky.png" }).click();
    await expect(item.getByText("Uploaded")).toBeAttached({ timeout: 20_000 });
    await send(page).click();
    const note = noteItem(page, caption);
    await expect(note.getByRole("button", { name: "Open image 1 of 1" })).toBeVisible();

    await erase(page, note);
  });

  test("an over-size file is refused before it uploads, and can be removed", async ({ page }) => {
    const big = { name: "huge.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(25 * 1024 * 1024 + 1) };
    await attach(page, [big]);
    const item = tray(page).getByRole("listitem", { name: "huge.mp4" });
    await expect(item.getByRole("alert")).toHaveText("A video may be at most 25 MB.");
    await expect(item.getByRole("button", { name: /Retry/ })).toHaveCount(0);
    await expect(send(page)).toBeDisabled();

    await item.getByRole("button", { name: "Remove huge.mp4" }).click();
    await expect(tray(page)).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("the picker, tray, album and viewer fit a 390px screen", async ({ page }) => {
      const caption = unique("phone album");
      await attach(page, [image("a.png", 1), image("b.png", 2), clip]);
      await expect(tray(page).getByText("Uploaded")).toHaveCount(3, { timeout: 20_000 });
      const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await noScroll()).toBe(true);

      await page.getByRole("textbox", { name: "New note" }).fill(caption);
      await send(page).click();
      const note = noteItem(page, caption);
      await expect(note.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveCount(3);
      const box = await note.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await noScroll()).toBe(true);

      // Swipe left to the next one.
      await note.getByRole("button", { name: "Open image 1 of 3" }).click();
      const viewer = page.getByRole("dialog");
      await expect(viewer.getByRole("img", { name: "Image 1 of 3" })).toBeVisible();
      const stage = viewer.getByRole("img", { name: "Image 1 of 3" });
      await stage.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 300, clientY: 400, bubbles: true });
      await stage.dispatchEvent("pointerup", { pointerType: "touch", clientX: 100, clientY: 400, bubbles: true });
      await expect(viewer.getByRole("img", { name: "Image 2 of 3" })).toBeVisible();
      const download = viewer.getByRole("button", { name: "Download" });
      const d = await download.boundingBox();
      expect(d!.x + d!.width).toBeLessThanOrEqual(390);
      await viewer.getByRole("button", { name: "Close" }).click();

      await erase(page, note);
    });
  });
});

test("a demo guest sees no attach button", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try Demo Mode (Guest Access)" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/dashboard/feed");
  await expect(page.getByRole("textbox", { name: "New note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach images or videos" })).toHaveCount(0);
});
