import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import {
  FEED_PAGES_KEPT,
  createLastSeenPersister,
  keepsLastSeen,
  lastSeenKey,
  trimForStorage,
  type LastSeenStore,
  SIGNED_IN_KEY,
  forgetSignedIn,
  rememberSignedIn,
  signedInOnDevice,
} from "./last-seen";

type DehydratedQuery = PersistedClient["clientState"]["queries"][number];

const query = (queryKey: unknown[], data: unknown): DehydratedQuery =>
  ({
    queryKey,
    queryHash: JSON.stringify(queryKey),
    state: { data, status: "success", dataUpdatedAt: 1 },
  }) as unknown as DehydratedQuery;

const client = (...queries: DehydratedQuery[]): PersistedClient => ({
  timestamp: 1,
  buster: "1",
  clientState: { queries, mutations: [] },
});

const feedPages = (n: number) => ({
  pages: Array.from({ length: n }, (_, i) => ({ notes: [{ id: `p${i}` }], older: `c${i}` })),
  pageParams: Array.from({ length: n }, (_, i) => (i === 0 ? undefined : `c${i - 1}`)),
});

describe("keepsLastSeen", () => {
  it("keeps what the pages show", () => {
    for (const key of [
      ["coreban", "feed", "all", false],
      ["kanban", "boards"],
      ["budget", "expenses"],
      ["boards"],
      ["draw", "board", "b1"],
    ]) {
      expect(keepsLastSeen(key), JSON.stringify(key)).toBe(true);
    }
  });

  it("never keeps admin data or Feed searches", () => {
    for (const key of [["users"], ["users", "u1"], ["backups"], ["coreban", "feed", "search", "lunch", "all", false, []]]) {
      expect(keepsLastSeen(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("never keeps the Feed's budget batches, which would show stale records as live", () => {
    expect(keepsLastSeen(["coreban", "feed", "all", false, "budget", { expense: ["e1"], income: [] }])).toBe(false);
    // The Feed's own Budget view is kept.
    expect(keepsLastSeen(["coreban", "feed", "budget", false])).toBe(true);
  });
});

describe("trimForStorage", () => {
  it("keeps only the Feed's newest pages, and their cursors", () => {
    const trimmed = trimForStorage(client(query(["coreban", "feed", "all", false], feedPages(FEED_PAGES_KEPT + 4))));
    const data = trimmed.clientState.queries[0].state.data as ReturnType<typeof feedPages>;
    expect(data.pages.map((p) => p.notes[0].id)).toEqual(["p0", "p1", "p2"]);
    expect(data.pageParams).toEqual([undefined, "c0", "c1"]);
  });

  it("leaves a short Feed and every other read as they are", () => {
    const short = query(["coreban", "feed", "notes", false], feedPages(2));
    const other = query(["kanban", "boards"], [{ id: "b1" }]);
    const days = query(["coreban", "feed", "days", "2026-11"], ["2026-11-02"]);
    const trimmed = trimForStorage(client(short, other, days));
    expect(trimmed.clientState.queries).toEqual([short, other, days]);
  });
});

describe("createLastSeenPersister", () => {
  let saved: Map<string, unknown>;
  let store: LastSeenStore;
  beforeEach(() => {
    vi.useFakeTimers();
    saved = new Map();
    store = {
      get: async (k) => saved.get(k),
      set: async (k, v) => void saved.set(k, v),
      del: async (k) => void saved.delete(k),
    };
  });
  afterEach(() => vi.useRealTimers());

  it("keeps each account's data apart", async () => {
    const a = createLastSeenPersister("user-a", store, 0);
    const b = createLastSeenPersister("user-b", store, 0);
    await a.persistClient(client(query(["kanban", "boards"], ["a's board"])));
    await vi.runAllTimersAsync();
    expect(await b.restoreClient()).toBeUndefined();
    expect((await a.restoreClient())?.clientState.queries[0].state.data).toEqual(["a's board"]);
    expect([...saved.keys()]).toEqual([lastSeenKey("user-a")]);
  });

  it("writes at most once a second, the latest state", async () => {
    const p = createLastSeenPersister("u", store, 1000);
    const writes = vi.spyOn(store, "set");
    for (let i = 0; i < 5; i++) await p.persistClient(client(query(["boards"], i)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveBeenCalledTimes(1);
    expect((await p.restoreClient())?.clientState.queries[0].state.data).toBe(4);
  });

  it("writes a waiting state at once when flushed, as the page goes away", async () => {
    const p = createLastSeenPersister("u", store, 1000);
    await p.persistClient(client(query(["boards"], 1)));
    p.flush();
    await Promise.resolve();
    expect(saved.size).toBe(1);
  });

  it("stores the Feed trimmed", async () => {
    const p = createLastSeenPersister("u", store, 0);
    await p.persistClient(client(query(["coreban", "feed", "all", false], feedPages(10))));
    await vi.runAllTimersAsync();
    const data = (await p.restoreClient())?.clientState.queries[0].state.data as ReturnType<typeof feedPages>;
    expect(data.pages).toHaveLength(FEED_PAGES_KEPT);
  });

  it("forgets on removeClient, dropping a write still waiting", async () => {
    const p = createLastSeenPersister("u", store, 1000);
    await p.persistClient(client(query(["boards"], 1)));
    await vi.advanceTimersByTimeAsync(1000);
    await p.persistClient(client(query(["boards"], 2)));
    await p.removeClient();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved.size).toBe(0);
  });

  it("writes nothing once closed, as on sign-out", async () => {
    const p = createLastSeenPersister("u", store, 0);
    await p.close();
    await p.persistClient(client(query(["boards"], 1)));
    await vi.runAllTimersAsync();
    expect(saved.size).toBe(0);
  });

  it("restores nothing when storage fails", async () => {
    const p = createLastSeenPersister("u", { ...store, get: () => Promise.reject(new Error("blocked")) }, 0);
    expect(await p.restoreClient()).toBeUndefined();
  });
});

describe("the account signed in on this device", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  const user = { id: "u1", email: "a@b.c", role: "user" as const, created_at: "" };

  it("is remembered until forgotten", () => {
    const s = memory();
    expect(signedInOnDevice(s)).toBeNull();
    rememberSignedIn(user, s);
    expect(signedInOnDevice(s)).toEqual(user);
    forgetSignedIn(s);
    expect(signedInOnDevice(s)).toBeNull();
  });

  it("reads nothing from a broken or foreign entry", () => {
    const s = memory();
    s.setItem(SIGNED_IN_KEY, "{not json");
    expect(signedInOnDevice(s)).toBeNull();
    s.setItem(SIGNED_IN_KEY, JSON.stringify({ email: "no id" }));
    expect(signedInOnDevice(s)).toBeNull();
  });
});
