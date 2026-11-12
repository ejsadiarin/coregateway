import { MAX_NOTE_LENGTH } from "@/lib/feed";

// What another app hands the installed app through the manifest's
// share_target: any part may be missing or blank. Chrome on Android shares a
// page as its title with the URL in text, leaving url empty.
export interface Shared {
  title: string | null;
  text: string | null;
  url: string | null;
}

// sharedNoteText turns a share into the text of one plain note: title, text
// and URL, one per line. A part repeating another is dropped, and so is a
// URL the text already holds (as Chrome shares it). Null when nothing was
// shared. Too long for a note, the text is cut, keeping a URL shared on its
// own whole when it fits.
export function sharedNoteText(shared: Shared): string | null {
  const [title, text, url] = [shared.title, shared.text, shared.url].map((p) => p?.trim() ?? "");
  const words = [title, text].filter((p, i, all) => p && all.indexOf(p) === i);
  const link = url && !words.some((p) => p.split(/\s+/).includes(url)) ? url : "";
  if (words.length === 0 && !link) return null;

  const joined = [...words, link].filter(Boolean).join("\n");
  if (joined.length <= MAX_NOTE_LENGTH) return joined;
  const tail = link && link.length < MAX_NOTE_LENGTH - 2 ? `\n${link}` : "";
  const body = tail ? words.join("\n") : joined;
  return `${cut(body, MAX_NOTE_LENGTH - tail.length - 1)}…${tail}`;
}

// cut shortens s to at most n UTF-16 units without splitting a surrogate
// pair (an emoji) in two.
function cut(s: string, n: number): string {
  const head = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

// safeReturnPath is where login goes once signed in: the page that sent the
// reader there, if it is a path in this app, else the dashboard. Anything
// that could leave the app ("//host", "/\host", a full URL) is refused.
export function safeReturnPath(from: unknown): string {
  return typeof from === "string" && from.startsWith("/") && !/^\/[/\\]/.test(from) ? from : "/dashboard";
}

// sharedFrom reads a share out of the share route's query string.
export const sharedFrom = (params: URLSearchParams): Shared => ({
  title: params.get("title"),
  text: params.get("text"),
  url: params.get("url"),
});
