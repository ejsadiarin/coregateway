// Files shared from another app (coreban#24). The service worker
// (public/sw.js) takes the share sheet's POST, keeps its files in this
// cache under /shared-files/<id>/<index>, and opens /share?files=<id>.

export const SHARED_FILES_CACHE = "core-shared-files";

const shareId = /^[0-9a-f-]{1,64}$/i;

// takeSharedFiles reads back one share's files, in the order they were
// shared, and removes them from the cache: they are taken once.
export async function takeSharedFiles(
  id: string,
  storage: Pick<CacheStorage, "open"> = caches,
): Promise<File[]> {
  if (!shareId.test(id)) return [];
  const cache = await storage.open(SHARED_FILES_CACHE);
  const prefix = `/shared-files/${id}/`;
  const mine = (await cache.keys())
    .map((request) => ({ request, path: new URL(request.url).pathname }))
    .filter((k) => k.path.startsWith(prefix))
    .sort((a, b) => Number(a.path.slice(prefix.length)) - Number(b.path.slice(prefix.length)));
  const files = await Promise.all(
    mine.map(async ({ request, path }) => {
      const res = await cache.match(request);
      await cache.delete(request);
      if (!res) return null;
      const type = res.headers.get("Content-Type") ?? "";
      const name = decodeURIComponent(res.headers.get("X-Filename") ?? "") || path.slice(prefix.length);
      return new File([await res.blob()], name, { type: type === "application/octet-stream" ? "" : type });
    }),
  );
  return files.filter((f): f is File => f !== null);
}
