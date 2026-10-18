import { describe, it, expect } from "vitest";
import type {
  ExcalidrawImageElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import {
  SNAPSHOT_VERSION,
  DEFAULT_APP_STATE,
  ICON_SIZE,
  iconFileId,
  spriteToDataUrl,
  buildIconInsertion,
  buildShapeElement,
  hydrateIconFiles,
  sceneToSnapshot,
  snapshotToScene,
  toExcalidrawTool,
  type ShapeKind,
} from "@/pages/dashboard/draw/engine";

const LAMBDA = "logos:aws-lambda";

describe("spriteToDataUrl", () => {
  it("encodes the vendored sprite as an svg data URL", () => {
    const url = spriteToDataUrl(LAMBDA);
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("<svg");
  });
});

describe("buildIconInsertion", () => {
  it("returns an image element and an editable text label sharing a group", () => {
    const { elements } = buildIconInsertion(LAMBDA, 100, 200);
    expect(elements).toHaveLength(2);

    const [glyph, label] = elements;
    expect(glyph.type).toBe("image");
    const image = glyph as ExcalidrawImageElement;
    expect(image.customData).toEqual({ iconId: LAMBDA });
    expect(image.fileId).toBe(iconFileId(LAMBDA));

    expect(label.type).toBe("text");
    const text = label as ExcalidrawTextElement;
    expect(text.text).toBe("Lambda");
    expect(text.fontSize).toBe(20);
    expect(text.textAlign).toBe("center");

    // Grouped so they move/select/delete as one, but only as a single group
    // that Excalidraw can break.
    expect(image.groupIds).toHaveLength(1);
    expect(image.groupIds[0]).toBe(text.groupIds[0]);

    // Label sits just below the glyph.
    expect(text.y).toBe(200 + ICON_SIZE + 6);
  });

  it("pre-fills the label with an explicit title when given one", () => {
    const { elements } = buildIconInsertion(LAMBDA, 0, 0, { title: "AWS Lambda" });
    expect((elements[1] as ExcalidrawTextElement).text).toBe("AWS Lambda");
  });

  it("bundles the glyph as an svg file for the canvas files map", () => {
    const { file } = buildIconInsertion(LAMBDA, 0, 0);
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.id).toBe(iconFileId(LAMBDA));
    expect(file.dataURL).toBe(spriteToDataUrl(LAMBDA));
  });
});

describe("buildShapeElement", () => {
  const kinds: ShapeKind[] = ["rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame"];

  it.each(kinds)("builds a %s element", (kind) => {
    expect(buildShapeElement(kind, 10, 20).type).toBe(kind);
  });
});

describe("hydrateIconFiles", () => {
  it("rebuilds an icon's svg file from the sprite by customData.iconId", () => {
    const { elements } = buildIconInsertion(LAMBDA, 0, 0);
    const files = hydrateIconFiles(elements);
    const file = files[iconFileId(LAMBDA)];
    expect(file).toBeDefined();
    expect(file.dataURL).toBe(spriteToDataUrl(LAMBDA));
    expect(file.mimeType).toBe("image/svg+xml");
  });

  it("ignores non-icon elements", () => {
    const files = hydrateIconFiles([buildShapeElement("rectangle", 0, 0)]);
    expect(Object.keys(files)).toHaveLength(0);
  });
});

describe("sceneToSnapshot / snapshotToScene", () => {
  it("stamps the current version and keeps only durable appState", () => {
    const elements = buildIconInsertion(LAMBDA, 0, 0).elements;
    const snap = sceneToSnapshot(elements, {
      viewBackgroundColor: "#fafafa",
      gridSize: 20,
      gridModeEnabled: true,
      // transient view state — must not persist
      scrollX: 999,
      scrollY: 888,
    });

    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(snap.appState).toEqual({
      viewBackgroundColor: "#fafafa",
      gridSize: 20,
      gridModeEnabled: true,
    });
  });

  it("drops deleted elements", () => {
    const [glyph, label] = buildIconInsertion(LAMBDA, 0, 0).elements;
    const snap = sceneToSnapshot([glyph, { ...label, isDeleted: true }], {});
    expect(snap.elements).toHaveLength(1);
    expect(snap.elements[0].type).toBe("image");
  });

  it("round-trips elements and re-hydrates icon files", () => {
    const elements = buildIconInsertion(LAMBDA, 0, 0).elements;
    const snap = sceneToSnapshot(elements, { viewBackgroundColor: "#ffffff" });
    const scene = snapshotToScene(snap);
    expect(scene.elements.map((e) => e.type)).toEqual(["image", "text"]);
    expect(scene.files[iconFileId(LAMBDA)]).toBeDefined();
  });

  it("loads an unknown/old version as a blank canvas", () => {
    expect(snapshotToScene({ version: 1, elements: [{ type: "image" }] }).elements).toHaveLength(0);
    expect(snapshotToScene({ store: {}, schema: {} }).elements).toHaveLength(0);
    expect(snapshotToScene({}).elements).toHaveLength(0);
    expect(snapshotToScene(null).appState).toEqual(DEFAULT_APP_STATE);
  });
});

describe("toExcalidrawTool", () => {
  it("maps the rail's tools", () => {
    expect(toExcalidrawTool("select")).toBe("selection");
    expect(toExcalidrawTool("draw")).toBe("freedraw");
    expect(toExcalidrawTool("frame")).toBe("frame");
  });

  it("falls back to the selection tool for unknown ids", () => {
    expect(toExcalidrawTool("lasso")).toBe("selection");
  });
});
