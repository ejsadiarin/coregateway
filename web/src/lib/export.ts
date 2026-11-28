import { apiBaseUrl as url, ApiError } from "@/lib/api";
import { isZip, listZip, readZipText, ZipError } from "@/lib/zip";
import type { FilePart, ImportResponse } from "@/types/export";

// The parts this gateway offers, in its export order. Adding a service's
// part is one entry here and one in the gateway's export.Parts.
export const EXPORT_PARTS = [
  { name: "budget", format: "coregateway.budget", label: "Budget", blurb: "Expenses, incomes, recurring rules and tags" },
  { name: "kanban", format: "coregateway.kanban", label: "Kanban and Feed", blurb: "Boards, cards, reminders and notes" },
  { name: "draw", format: "coregateway.draw", label: "Draw", blurb: "Whiteboards with their side docs" },
  { name: "account", format: "coregateway.account", label: "Account", blurb: "Your email, role and timezone, for reference", exportOnly: true },
] as const;

// isExportOnly is a part an import reads but never applies.
export function isExportOnly(name: string): boolean {
  return EXPORT_PARTS.some((p) => p.name === name && "exportOnly" in p && p.exportOnly);
}

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
// A zip export carries photos and videos beside its file.
export const MAX_ZIP_IMPORT_BYTES = 10 * 1024 * 1024 * 1024;
// The part whose photos and videos a zip export carries.
export const MEDIA_PART = "kanban";

const BUNDLE_FORMAT = "coregateway.export";
// An export from before parts were versioned: the budget's own rows.
const LEGACY_BUDGET_KEYS = ["expenses", "incomes", "tags", "recurring_expenses", "recurring_incomes"];

export class ExportFileError extends Error {}

async function failure(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new ApiError(res.status, typeof body?.error === "string" ? body.error : fallback);
}

// partsQuery is ?parts= for a choice, or nothing when it is every part, so
// the gateway answers with a bundle even while it has only one part.
function partsQuery(parts: string[], all: readonly string[]): string {
  const everything = all.length === parts.length && all.every((p) => parts.includes(p));
  return everything ? "" : `parts=${parts.map(encodeURIComponent).join(",")}`;
}

function exportUrl(parts: string[], media: boolean): string {
  const query = [partsQuery(parts, EXPORT_PARTS.map((p) => p.name)), media ? "media=true" : ""].filter(Boolean).join("&");
  return `${url}/api/export${query ? `?${query}` : ""}`;
}

// downloadExport saves the chosen parts as one JSON file (at most 25 MB)
// as the gateway names it, and returns that name.
export async function downloadExport(parts: string[]): Promise<string> {
  const res = await fetch(exportUrl(parts, false), { credentials: "include" });
  if (!res.ok) await failure(res, "Export failed");
  const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "coregateway-export.json";
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return name;
}

// startMediaExport downloads the chosen parts with their photos and videos
// as a zip, which may be many gigabytes. A hidden iframe hands the request
// to the browser's own download manager, which streams the zip to disk as
// it arrives, so the page never holds it. A zip download loads nothing into
// the iframe; a failure before the zip starts is the gateway's JSON error,
// which does, and onError gets its message.
export function startMediaExport(parts: string[], onError: (message: string) => void): void {
  document.getElementById(MEDIA_FRAME)?.remove();
  const frame = document.createElement("iframe");
  frame.id = MEDIA_FRAME;
  frame.hidden = true;
  frame.title = "Export download";
  document.body.appendChild(frame);
  frame.addEventListener("load", () => onError(frameError(frame)));
  frame.src = exportUrl(parts, true);
}

const MEDIA_FRAME = "coregateway-media-export";

// frameError is the gateway's error from a failed export the iframe
// loaded. Its text is readable only on the app's own origin (production,
// where nginx serves /api/); elsewhere it is a generic message.
function frameError(frame: HTMLIFrameElement): string {
  try {
    const text = frame.contentDocument?.body?.textContent ?? "";
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // another origin, or not the gateway's JSON
  }
  return "Export failed. Try again.";
}

// readExportFile lists the parts in a file: a bundle's parts, one part's
// own file, or an unversioned budget export.
export function readExportFile(text: string): FilePart[] {
  let top: unknown;
  try {
    top = JSON.parse(text);
  } catch {
    throw new ExportFileError("This file isn't JSON.");
  }
  if (!top || typeof top !== "object" || Array.isArray(top)) throw new ExportFileError("This file isn't an export.");
  const file = top as Record<string, unknown>;
  const known = (name: string) => EXPORT_PARTS.some((p) => p.name === name);

  if (file.format === BUNDLE_FORMAT) {
    const parts = file.parts && typeof file.parts === "object" ? (file.parts as Record<string, Record<string, unknown>>) : {};
    const found = Object.entries(parts).map(([name, part]) => ({
      name,
      format: typeof part?.format === "string" ? part.format : "",
      version: typeof part?.version === "number" ? part.version : 0,
      known: known(name),
    }));
    if (!found.length) throw new ExportFileError("This export has no parts.");
    return sortParts(found);
  }
  if (typeof file.format === "string") {
    const part = EXPORT_PARTS.find((p) => p.format === file.format);
    if (!part) throw new ExportFileError(`This file is a ${file.format} file, not an export.`);
    return [{ name: part.name, format: part.format, version: typeof file.version === "number" ? file.version : 0, known: true }];
  }
  if (LEGACY_BUDGET_KEYS.some((k) => k in file)) {
    return [{ name: "budget", format: "coregateway.budget", version: 0, known: true }];
  }
  throw new ExportFileError("This file isn't an export.");
}

function sortParts(parts: FilePart[]): FilePart[] {
  const order = (name: string) => {
    const i = EXPORT_PARTS.findIndex((p) => p.name === name);
    return i < 0 ? EXPORT_PARTS.length : i;
  };
  return [...parts].sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
}

// ExportFile is a chosen file ready to import: the JSON text, or a zip with
// its photos and videos (sent whole, as it is).
export interface ExportFile {
  body: string | Blob;
  zip: boolean;
  parts: FilePart[];
  // How many photo, video and poster files a zip holds.
  mediaFiles: number;
}

// openExportFile reads a chosen file: a JSON export, or a zip whose
// export.json lists its parts.
export async function openExportFile(file: Blob): Promise<ExportFile> {
  if (!(await isZip(file))) {
    if (file.size > MAX_IMPORT_BYTES) throw new ExportFileError("This file is larger than 25 MB.");
    const text = await file.text();
    return { body: text, zip: false, parts: readExportFile(text), mediaFiles: 0 };
  }
  if (file.size > MAX_ZIP_IMPORT_BYTES) throw new ExportFileError("This zip is larger than 10 GB.");
  try {
    const entries = await listZip(file);
    const main = entries.find((e) => e.name === "export.json");
    if (!main) throw new ExportFileError("This zip has no export.json, so it isn't an export.");
    const parts = readExportFile(await readZipText(file, main));
    const mediaFiles = entries.filter((e) => e.name.startsWith("media/") && !e.name.endsWith("/")).length;
    return { body: file, zip: true, parts, mediaFiles };
  } catch (err) {
    if (err instanceof ZipError) throw new ExportFileError(err.message);
    throw err;
  }
}

// importExport sends the file as it is, with the parts to bring in. A dry
// run reports what would happen and writes nothing.
export async function importExport(file: ExportFile, parts: string[], inFile: string[], dryRun: boolean): Promise<ImportResponse> {
  const query = [partsQuery(parts, inFile), dryRun ? "dry_run=true" : ""].filter(Boolean).join("&");
  const res = await fetch(`${url}/api/import${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": file.zip ? "application/zip" : "application/json" },
    credentials: "include",
    body: file.body,
  });
  if (!res.ok) await failure(res, "Import failed");
  return res.json();
}
