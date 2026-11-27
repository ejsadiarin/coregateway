import { apiBaseUrl as url, ApiError } from "@/lib/api";
import type { FilePart, ImportResponse } from "@/types/export";

// The parts this gateway offers, in its export order. Adding a service's
// part is one entry here and one in the gateway's export.Parts.
export const EXPORT_PARTS = [
  { name: "budget", format: "coregateway.budget", label: "Budget", blurb: "Expenses, incomes, recurring rules and tags" },
  { name: "kanban", format: "coregateway.kanban", label: "Kanban and Feed", blurb: "Boards, cards, reminders and notes; photo and video files stay out" },
] as const;

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

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

// downloadExport saves the chosen parts as the gateway names the file, and
// returns that name.
export async function downloadExport(parts: string[]): Promise<string> {
  const query = partsQuery(parts, EXPORT_PARTS.map((p) => p.name));
  const res = await fetch(`${url}/api/export${query ? `?${query}` : ""}`, { credentials: "include" });
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

// importExport sends the file as it is, with the parts to bring in. A dry
// run reports what would happen and writes nothing.
export async function importExport(text: string, parts: string[], inFile: string[], dryRun: boolean): Promise<ImportResponse> {
  const query = [partsQuery(parts, inFile), dryRun ? "dry_run=true" : ""].filter(Boolean).join("&");
  const res = await fetch(`${url}/api/import${query ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: text,
  });
  if (!res.ok) await failure(res, "Import failed");
  return res.json();
}
