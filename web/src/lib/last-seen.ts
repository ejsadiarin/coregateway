// Last-seen data (CONTEXT "Offline", ADR-0009 decisions 6 and 7): what each
// page last loaded, React Query's cache kept in IndexedDB per account, so a
// page shows it with no connection. A fresh load replaces it; there is no age
// limit; signing out clears it.
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { feedKey, isFeedData } from "@/lib/feed";
import type { User } from "@/types/api";

// Bump when a release changes the shape of any data kept here: every
// device then drops what it saved and starts from fresh loads.
export const LAST_SEEN_VERSION = "1";

// How many of the Feed's pages are kept, newest first: the ones it opens on,
// not every page ever scrolled back to.
export const FEED_PAGES_KEPT = 3;

// Where an account's last-seen data lives in IndexedDB.
export const lastSeenKey = (userId: string) => `last-seen:${userId}`;

// Reads that are never kept on the device: admin data (the users and the
// backups), which only an admin may see and which needs a connection anyway.
const NEVER_KEPT = new Set(["users", "backups"]);

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) => prefix.every((p, i) => key[i] === p);

// keepsLastSeen says whether a read is kept as last-seen data. A Feed search
// is not: offline, search runs over the Feed's own saved pages instead. Nor
// are the Feed's budget batches (its view's key, then "budget"): restored,
// they would show a record as it was, as if read just now, and be
// remembered that way; offline the Feed fills its budget notes from what
// it last showed (recordsFromShown).
export function keepsLastSeen(queryKey: readonly unknown[]): boolean {
  if (NEVER_KEPT.has(queryKey[0] as string)) return false;
  if (!startsWith(queryKey, feedKey)) return true;
  return queryKey[feedKey.length] !== "search" && queryKey[feedKey.length + 2] !== "budget";
}

// trimForStorage cuts each of the Feed's cached views down to its newest
// FEED_PAGES_KEPT pages; everything else is kept as it is.
export function trimForStorage(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries.map((q) => {
    const data = q.state.data;
    if (!startsWith(q.queryKey, feedKey) || !isFeedData(data) || data.pages.length <= FEED_PAGES_KEPT) return q;
    const trimmed = {
      pages: data.pages.slice(0, FEED_PAGES_KEPT),
      pageParams: data.pageParams.slice(0, FEED_PAGES_KEPT),
    };
    return { ...q, state: { ...q.state, data: trimmed } };
  });
  return { ...client, clientState: { ...client.clientState, queries } };
}

// LastSeenStore is the key-value storage behind it: idb-keyval in the app,
// which keeps values by structured clone (the Feed's budget reads hold Maps).
export interface LastSeenStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export interface LastSeenPersister extends Persister {
  // Write a waiting state now: the page is going away.
  flush(): void;
  // Stop writing for good and delete what was kept: signing out.
  close(): Promise<void>;
}

// createLastSeenPersister keeps one account's last-seen data, writing the
// latest state at most once per throttleMs. Storage that fails (full,
// blocked, a private window) only means nothing is kept.
export function createLastSeenPersister(userId: string, store: LastSeenStore, throttleMs = 1000): LastSeenPersister {
  const key = lastSeenKey(userId);
  let pending: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const client = pending;
    pending = null;
    if (closed || !client) return;
    store.set(key, trimForStorage(client)).catch(() => {});
  };
  const drop = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
  };

  return {
    persistClient(client) {
      if (closed) return;
      pending = client;
      timer ??= setTimeout(flush, throttleMs);
    },
    flush,
    async restoreClient() {
      try {
        const client = (await store.get(key)) as PersistedClient | undefined;
        // Signed out meanwhile: nothing of the account may come back.
        return closed ? undefined : client;
      } catch {
        return undefined;
      }
    },
    async removeClient() {
      drop();
      await store.del(key).catch(() => {});
    },
    async close() {
      closed = true;
      drop();
      await store.del(key).catch(() => {});
    },
  };
}

// The account last signed in on this device, so a page opened offline knows
// whose last-seen data to show while the session can't be checked. Only the
// gateway answering decides who is signed in; this is never sent anywhere.
export const SIGNED_IN_KEY = "core.signed-in";

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const device = (): KeyValue | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

export function signedInOnDevice(storage = device()): User | null {
  try {
    const user = JSON.parse(storage?.getItem(SIGNED_IN_KEY) ?? "null");
    return typeof user?.id === "string" && user.id ? (user as User) : null;
  } catch {
    return null;
  }
}

export function rememberSignedIn(user: User, storage = device()): void {
  try {
    storage?.setItem(SIGNED_IN_KEY, JSON.stringify(user));
  } catch {
    // Storage full or blocked: offline, the app just can't open the account.
  }
}

export function forgetSignedIn(storage = device()): void {
  try {
    storage?.removeItem(SIGNED_IN_KEY);
  } catch {
    // Blocked storage holds nothing to forget.
  }
}
