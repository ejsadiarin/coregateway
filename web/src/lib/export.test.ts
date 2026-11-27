import { describe, expect, it } from "vitest";
import { ExportFileError, readExportFile } from "./export";

describe("readExportFile", () => {
  it("lists a bundle's parts, known ones first", () => {
    const parts = readExportFile(
      JSON.stringify({
        format: "coregateway.export",
        version: 1,
        parts: { garden: { format: "coregateway.garden", version: 3 }, budget: { format: "coregateway.budget", version: 1 } },
      }),
    );
    expect(parts).toEqual([
      { name: "budget", format: "coregateway.budget", version: 1, known: true },
      { name: "garden", format: "coregateway.garden", version: 3, known: false },
    ]);
  });

  it("reads one part's own file", () => {
    expect(readExportFile(JSON.stringify({ format: "coregateway.budget", version: 1, data: {} }))).toEqual([
      { name: "budget", format: "coregateway.budget", version: 1, known: true },
    ]);
  });

  it("reads an unversioned budget export as version 0", () => {
    expect(readExportFile(JSON.stringify({ expenses: [], tags: [] }))).toEqual([
      { name: "budget", format: "coregateway.budget", version: 0, known: true },
    ]);
  });

  it.each([
    ["not json", "This file isn't JSON."],
    ["[]", "This file isn't an export."],
    [JSON.stringify({ hello: "world" }), "This file isn't an export."],
    [JSON.stringify({ format: "coregateway.export", version: 1, parts: {} }), "This export has no parts."],
    [JSON.stringify({ format: "something.else" }), "This file is a something.else file, not an export."],
  ])("refuses %s", (text, message) => {
    expect(() => readExportFile(text)).toThrow(ExportFileError);
    expect(() => readExportFile(text)).toThrow(message);
  });
});
