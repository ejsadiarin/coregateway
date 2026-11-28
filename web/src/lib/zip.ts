// A minimal zip reader for the Data page: it lists a zip's entries and
// reads one, slicing only what it needs from the file, so a zip of photos
// and videos is never loaded whole. It reads what the gateway writes
// (stored or deflated entries, no zip64) and what common tools write for
// files under 4 GB.

export interface ZipEntry {
  name: string;
  method: number; // 0 stored, 8 deflated
  compressedSize: number;
  size: number;
  offset: number; // of its local header
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

// isZip says whether a file starts with a zip's local header.
export async function isZip(file: Blob): Promise<boolean> {
  if (file.size < 4) return false;
  return (await bytes(file, 0, 4)).getUint32(0, true) === LOCAL;
}

// listZip reads a zip's central directory.
export async function listZip(file: Blob): Promise<ZipEntry[]> {
  // The end record is in the last 22 bytes, or before a comment of up to 64 KB.
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await bytes(file, tailStart, file.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError("This zip can't be read.");
  const count = tail.getUint16(at + 10, true);
  const dirSize = tail.getUint32(at + 12, true);
  const dirOffset = tail.getUint32(at + 16, true);
  const dir = await bytes(file, dirOffset, dirOffset + dirSize);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > dir.byteLength || dir.getUint32(p, true) !== CENTRAL) throw new ZipError("This zip can't be read.");
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    entries.push({
      method: dir.getUint16(p + 10, true),
      compressedSize: dir.getUint32(p + 20, true),
      size: dir.getUint32(p + 24, true),
      offset: dir.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// readZipText reads one entry as text.
export async function readZipText(file: Blob, entry: ZipEntry): Promise<string> {
  const head = await bytes(file, entry.offset, entry.offset + 30);
  if (head.getUint32(0, true) !== LOCAL) throw new ZipError("This zip can't be read.");
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const data = file.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return data.text();
  if (entry.method !== 8) throw new ZipError("This zip uses a compression this page can't read.");
  const stream = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
