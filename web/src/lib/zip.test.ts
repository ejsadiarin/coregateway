import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { openExportFile, ExportFileError } from "./export";
import { isZip, listZip, readZipText } from "./zip";

// zipOf builds a zip as the gateway writes one: each entry stored or
// deflated, with a central directory at the end.
function zipOf(entries: { name: string; body: string; deflate?: boolean }[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = enc.encode(e.body);
    const data: Uint8Array<ArrayBuffer> = e.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, e.deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(10, e.deflate ? 8 : 0, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)]);
}

const bundle = JSON.stringify({
  format: "coregateway.export",
  version: 1,
  parts: { kanban: { format: "coregateway.kanban", version: 1, data: {} } },
});

describe("zip", () => {
  it("lists entries and reads stored and deflated ones", async () => {
    const zip = zipOf([
      { name: "export.json", body: bundle, deflate: true },
      { name: "media/a", body: "photo" },
    ]);
    expect(await isZip(zip)).toBe(true);
    const entries = await listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["export.json", "media/a"]);
    expect(await readZipText(zip, entries[0])).toBe(bundle);
    expect(await readZipText(zip, entries[1])).toBe("photo");
  });

  it("opens a zip export: its parts, its media count, and the zip to send", async () => {
    const zip = zipOf([
      { name: "export.json", body: bundle, deflate: true },
      { name: "media/a", body: "photo" },
      { name: "media/b.poster", body: "p" },
    ]);
    const file = await openExportFile(zip);
    expect(file.zip).toBe(true);
    expect(file.body).toBe(zip);
    expect(file.mediaFiles).toBe(2);
    expect(file.parts.map((p) => p.name)).toEqual(["kanban"]);
  });

  it("refuses a zip without export.json", async () => {
    await expect(openExportFile(zipOf([{ name: "media/a", body: "x" }]))).rejects.toThrow(ExportFileError);
  });

  it("still opens a JSON export", async () => {
    const file = await openExportFile(new Blob([bundle]));
    expect(file.zip).toBe(false);
    expect(file.body).toBe(bundle);
  });
});
