import { describe, expect, it } from "vitest";
import { takeSharedFiles, SHARED_FILES_CACHE } from "./shared-files";

// An in-memory CacheStorage holding what the service worker stores.
function storage(entries: Record<string, { body: string; type: string; name: string }>) {
  const map = new Map(
    Object.entries(entries).map(([url, e]) => [
      new URL(url, "https://core.test").href,
      () => new Response(e.body, { headers: { "Content-Type": e.type, "X-Filename": encodeURIComponent(e.name) } }),
    ]),
  );
  const cache = {
    keys: async () => [...map.keys()].map((u) => new Request(u)),
    match: async (r: Request) => map.get(r.url)?.(),
    delete: async (r: Request) => map.delete(r.url),
  };
  const opened: string[] = [];
  return {
    map,
    opened,
    open: async (name: string) => {
      opened.push(name);
      return cache as unknown as Cache;
    },
  };
}

describe("takeSharedFiles", () => {
  it("reads one share's files back in the order shared, with their names and types, and forgets them", async () => {
    const s = storage({
      "/shared-files/abc/1": { body: "second", type: "video/mp4", name: "clip one.mp4" },
      "/shared-files/abc/0": { body: "first", type: "image/png", name: "IMG_0001.png" },
      "/shared-files/abc/10": { body: "eleventh", type: "image/png", name: "late.png" },
      "/shared-files/other/0": { body: "not this share", type: "image/png", name: "x.png" },
    });
    const files = await takeSharedFiles("abc", s);
    expect(s.opened).toEqual([SHARED_FILES_CACHE]);
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ["IMG_0001.png", "image/png"],
      ["clip one.mp4", "video/mp4"],
      ["late.png", "image/png"],
    ]);
    expect(await files[0].text()).toBe("first");
    expect([...s.map.keys()]).toEqual(["https://core.test/shared-files/other/0"]);
  });

  it("finds nothing for a share already taken, or an id that isn't one", async () => {
    const s = storage({});
    expect(await takeSharedFiles("abc", s)).toEqual([]);
    expect(await takeSharedFiles("../x", s)).toEqual([]);
  });
});
