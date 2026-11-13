import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";

import { ADMIN, expect, login, test } from "./fixtures";

// Sharing images and videos from another app (coreban#24). Android sends
// the manifest's share_target as a multipart POST to /share, which only the
// service worker can take: it keeps the files on the phone and opens the
// Feed with them in the chat box. These tests submit that POST the way the
// share sheet does, from a page the service worker controls. Service
// workers need a secure origin, so this file runs in its own project with
// the e2e host treated as one (playwright.config.ts).

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const feed = (page: Page) => page.getByRole("log", { name: "Feed" });
const noteItem = (page: Page, text: string) => feed(page).getByRole("listitem").filter({ hasText: text });
const tray = (page: Page) => page.getByRole("list", { name: "Attachments to send" });

// A small real PNG, so the browser can decode and re-encode it.
function png(seed: number): string {
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
  const [w, h] = [64, 48];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([(seed * 50 + x) & 0xff, 120, (x * 3) & 0xff], 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

interface SharedFile {
  name: string;
  type: string;
  base64: string;
}

// waitForWorker opens the app and waits until its service worker controls
// the page, as it does in the installed app.
async function waitForWorker(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
}

// share submits what the share sheet submits: a multipart POST to /share
// with title, text, url and files.
async function share(page: Page, fields: Record<string, string>, files: SharedFile[]) {
  await page.evaluate(
    ({ fields, files }) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/share";
      form.enctype = "multipart/form-data";
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.name = name;
        input.value = value;
        form.append(input);
      }
      const input = document.createElement("input");
      input.type = "file";
      input.name = "files";
      input.multiple = true;
      const picked = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        picked.items.add(new File([bytes], f.name, { type: f.type }));
      }
      input.files = picked.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { fields, files },
  );
}

const photo = (name: string, seed = 0): SharedFile => ({ name, type: "image/png", base64: png(seed) });

test("the manifest takes shared images and videos as a multipart POST", async ({ page }) => {
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.share_target).toEqual({
    action: "/share",
    method: "POST",
    enctype: "multipart/form-data",
    params: {
      title: "title",
      text: "text",
      url: "url",
      files: [{ name: "files", accept: ["image/*", "video/*"] }],
    },
  });
  // Android lists a share target only inside the app's scope.
  expect(manifest.share_target.action.startsWith(manifest.scope)).toBe(true);
});

test("a shared image waits in the chat box with its caption, and Send posts it", async ({ page }) => {
  await login(page);
  await waitForWorker(page);
  const caption = unique("from the gallery");
  await share(page, { text: caption }, [photo("IMG_0001.png")]);

  await page.waitForURL("**/dashboard/feed");
  await expect(tray(page).getByRole("listitem", { name: "IMG_0001.png" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue(caption);
  await expect(tray(page).getByText("Uploaded")).toHaveCount(1, { timeout: 20_000 });
  // Nothing posts until Send.
  await expect(noteItem(page, caption)).toHaveCount(0);

  await page.getByRole("button", { name: "Send" }).click();
  const note = noteItem(page, caption);
  await expect(note.getByRole("button", { name: "Open image 1 of 1" })).toBeVisible();

  // A reload doesn't bring the shared files back.
  await page.reload();
  await expect(noteItem(page, caption)).toBeVisible();
  await expect(tray(page)).toHaveCount(0);

  await note.getByRole("button", { name: "Note actions" }).click();
  await page.getByRole("menuitem", { name: "Permanently delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Permanently delete" }).click();
});

test("text shared by POST still posts at once", async ({ page }) => {
  await login(page);
  await waitForWorker(page);
  const text = unique("shared by post");
  await share(page, { title: text, text: "https://example.com/post" }, []);
  await page.waitForURL("**/dashboard/feed");
  await expect(noteItem(page, text)).toBeVisible();
  await expect(tray(page)).toHaveCount(0);
});

test("more than ten shared files: ten wait, and the rest are refused with a message", async ({ page }) => {
  await login(page);
  await waitForWorker(page);
  await share(page, {}, Array.from({ length: 12 }, (_, i) => photo(`p${i}.png`, i)));
  await page.waitForURL("**/dashboard/feed");
  await expect(tray(page).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByText("A note holds at most 10 attachments; 2 left out.")).toBeVisible();
  for (let i = 0; i < 10; i++) await tray(page).getByRole("button", { name: `Remove p${i}.png` }).click();
});

test("files shared while signed out wait through login", async ({ page }) => {
  await waitForWorker(page);
  const caption = unique("shared signed out");
  await share(page, { text: caption }, [photo("later.png", 3)]);
  await page.waitForURL("**/login");

  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Access System" }).click();
  await page.waitForURL("**/dashboard/feed");
  await expect(tray(page).getByRole("listitem", { name: "later.png" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue(caption);
  await tray(page).getByRole("button", { name: "Remove later.png" }).click();
});

test("an empty shared file is refused as the picker refuses it", async ({ page }) => {
  await login(page);
  await waitForWorker(page);
  await share(page, {}, [{ name: "not-synced.jpg", type: "image/jpeg", base64: "" }]);
  await page.waitForURL("**/dashboard/feed");
  const item = tray(page).getByRole("listitem", { name: "not-synced.jpg" });
  await expect(item.getByRole("alert")).toHaveText("not-synced.jpg is empty.");
  await item.getByRole("button", { name: "Remove not-synced.jpg" }).click();
});

test("shared files that went missing say so instead of vanishing", async ({ page }) => {
  await login(page);
  await page.goto(`/share?${new URLSearchParams({ text: "lost caption", files: "0b6f3c3e-0000-4000-8000-000000000000" })}`);
  await page.waitForURL("**/dashboard/feed");
  await expect(page.getByText("Couldn't open the shared images or videos; share them again.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("lost caption");
});

test("files that couldn't be kept leave their text to post on its own", async ({ page }) => {
  await login(page);
  const text = unique("text without its photos");
  await page.goto(`/share?${new URLSearchParams({ text, failed: "files" })}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("couldn't be kept on this phone");
  await main.getByRole("button", { name: "Post the text only" }).click();
  await page.waitForURL("**/dashboard/feed");
  await expect(noteItem(page, text)).toBeVisible();
});
