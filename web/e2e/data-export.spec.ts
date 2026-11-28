import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { listZip } from "../src/lib/zip";
import { API_URL as api, expect, login, test } from "./fixtures";

const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const today = () => new Date().toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await login(page);
});

// Export, then import the same file back: every row is already yours, so a
// check and the import both report everything as already here.
test("export downloads a bundle that imports back with nothing new", async ({ page }) => {
  const res = await page.request.post(`${api}/api/budget/expenses`, {
    data: { amount: 42, currency: "PHP", description: unique("Export"), expense_date: today(), priority: "want", status: "posted", is_debt: false },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const id = ((await res.json()) as { id: string }).id;

  try {
    await page.goto("/dashboard/settings#data");
    await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeVisible();
    // Import and export left the Budget section.
    await expect(page.locator("#budget").getByRole("button", { name: /export/i })).toHaveCount(0);

    // Without photos and videos it is one JSON file.
    await page.getByRole("checkbox", { name: /Include photos and videos/ }).uncheck();
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await exporting;
    expect(download.suggestedFilename()).toMatch(/^coregateway-export-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await readFile(await download.path());
    const bundle = JSON.parse(file.toString());
    expect(bundle.format).toBe("coregateway.export");
    expect(bundle.parts.budget.format).toBe("coregateway.budget");
    expect(bundle.parts.budget.data.expenses.some((e: { id: string }) => e.id === id)).toBe(true);
    expect(bundle.parts.kanban.format).toBe("coregateway.kanban");
    expect(bundle.parts.draw.format).toBe("coregateway.draw");
    expect(bundle.parts.account.data.email).toBe("admin@e2e.local");

    await page.getByLabel("Export file").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: file });
    const parts = page.getByRole("group", { name: "Parts to import" });
    await expect(parts.getByRole("checkbox", { name: /Budget/ })).toBeChecked();
    await expect(parts.getByRole("checkbox", { name: /Kanban/ })).toBeChecked();
    // The account part is listed for reference and never imported.
    await expect(parts.getByRole("checkbox", { name: /Account/ })).toBeDisabled();
    await expect(parts.getByText("For reference only; importing never changes your account")).toBeVisible();

    await page.getByRole("button", { name: "Check" }).click();
    const result = page.getByTestId("import-result-budget");
    await expect(result).toContainText("Would import");
    await expect(page.getByText("Check: nothing was written")).toBeVisible();
    await expect(result.getByText("0 new").first()).toBeVisible();

    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(result).toContainText("Imported");
    await expect(result.getByText("expenses", { exact: true })).toBeVisible();
    await expect(result).not.toContainText(/[1-9]\d* new/);
    await expect(page.getByTestId("import-result-kanban")).toContainText("Imported");
    await expect(page.getByTestId("import-result-draw")).toContainText("Imported");
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});

// An export from before versions (the budget's own rows) still imports.
test("an unversioned budget export imports from the Data section", async ({ page }) => {
  const id = randomUUID();
  const description = unique("Old export");
  const old = {
    expense_categories: [],
    income_categories: [],
    tags: [],
    expenses: [{ id, amount: "7", currency: "PHP", exchange_rate: "1", amount_php: "7", rate_date: today(), description, expense_date: today(), priority: "want", status: "posted", is_debt: false }],
    incomes: [],
    recurring_expenses: [],
    recurring_incomes: [],
    expense_tags: [],
    income_tags: [],
  };

  try {
    await page.goto("/dashboard/settings#data");
    await page.getByLabel("Export file").setInputFiles({ name: "budget_export.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
    await expect(page.getByText("An older export, from before versions")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const result = page.getByTestId("import-result-budget");
    await expect(result).toContainText("Imported");
    await expect(result.getByText("1 new")).toBeVisible();

    await page.goto("/dashboard/budget/expenses");
    await expect(page.getByText(description).first()).toBeVisible();
  } finally {
    await page.request.delete(`${api}/api/budget/expenses/${id}`);
  }
});

test("a file that isn't an export is refused before upload", async ({ page }) => {
  await page.goto("/dashboard/settings#data");
  await page.getByLabel("Export file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from(`{"hello":"world"}`) });
  await expect(page.getByText("This file isn't an export.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check" })).toHaveCount(0);
});

// A 1x1 WebP, for a photo note.
const PIXEL = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

// A full export with photos is a zip; deleting the photo note and
// importing that zip brings the note back with its file.
test("a zip export with photos restores a deleted photo note", async ({ page }) => {
  const caption = unique("Zip photo");
  const reserved = await page.request.post(`${api}/api/coreban/attachments`, {
    data: { kind: "image", content_type: "image/webp", size: PIXEL.length, width: 1, height: 1 },
  });
  expect(reserved.ok(), await reserved.text()).toBe(true);
  const { id: photo, upload } = (await reserved.json()) as { id: string; upload: { url: string; headers: Record<string, string> } };
  expect((await page.request.put(upload.url, { headers: upload.headers, data: PIXEL })).ok()).toBe(true);
  const posted = await page.request.post(`${api}/api/coreban/notes`, { data: { text: caption, attachments: [photo] } });
  expect(posted.ok(), await posted.text()).toBe(true);
  const note = ((await posted.json()) as { id: string }).id;

  await page.goto("/dashboard/settings#data");
  await expect(page.getByRole("checkbox", { name: /Include photos and videos/ })).toBeChecked();
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await exporting;
  expect(download.suggestedFilename()).toMatch(/^coregateway-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const file = await readFile(await download.path());
  const entries = await listZip(new Blob([file]));
  expect(entries.map((e) => e.name)).toContain("export.json");
  expect(entries.map((e) => e.name)).toContain(`media/${photo}`);

  expect((await page.request.delete(`${api}/api/coreban/notes/${note}`)).ok()).toBe(true);

  await page.getByLabel("Export file").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/zip", buffer: file });
  const parts = page.getByRole("group", { name: "Parts to import" });
  await expect(parts.getByText(/with \d+ photo and video files?/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const result = page.getByTestId("import-result-kanban");
  await expect(result).toContainText("Imported");

  const feed = await (await page.request.get(`${api}/api/coreban/notes?size=50`)).text();
  const restored = (JSON.parse(feed).notes as { id: string; attachments?: { id: string; url?: string }[] }[]).find((n) => n.id === note);
  expect(restored, "the deleted note is back").toBeTruthy();
  expect(restored!.attachments?.[0]?.id).toBe(photo);
  expect(restored!.attachments?.[0]?.url).toBeTruthy();
});

// A zip export the gateway refuses before it starts shows an error on the
// page instead of downloading.
test("a failed zip export shows its error", async ({ page }) => {
  await page.route(/\/api\/export\?.*media=true/, (r) =>
    r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "no service could export its part" }) }),
  );
  await page.goto("/dashboard/settings#data");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  // On another origin (this dev stack) the page can't read the frame, so it
  // says the export failed; on its own origin it shows the gateway's words.
  await expect(page.getByText(/no service could export its part|Export failed\. Try again\./)).toBeVisible();
});
