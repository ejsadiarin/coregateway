import { describe, it, expect } from "vitest";
import type {
  ExcalidrawImageElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import {
  SNAPSHOT_VERSION,
  DEFAULT_APP_STATE,
  FORMAL_DRAW_DEFAULTS,
  ICON_SIZE,
  iconFileId,
  spriteToDataUrl,
  buildIconInsertion,
  buildShapeElement,
  hydrateIconFiles,
  sceneToSnapshot,
  snapshotToScene,
  TOOL_MAP,
  toolForShortcut,
  railToolForCanvasTool,
  type ShapeKind,
} from "@/pages/dashboard/draw/engine";
import { iconLabel } from "@/pages/dashboard/draw/icon-catalog";

const LAMBDA = "logos:aws-lambda";

describe("spriteToDataUrl", () => {
  it("encodes the vendored sprite as a base64 svg data URL", () => {
    const url = spriteToDataUrl(LAMBDA);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(atob(url.slice(url.indexOf(",") + 1))).toContain("<svg");
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
    expect(text.text).toBe("AWS Lambda");
    expect(text.fontSize).toBe(20);
    expect(text.fontFamily).toBe(3);
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

  it("defaults to crisp strokes and mono text", () => {
    expect(buildShapeElement("rectangle", 0, 0).roughness).toBe(0);
    const text = buildShapeElement("text", 0, 0) as ExcalidrawTextElement;
    expect(text.roughness).toBe(0);
    expect(text.fontFamily).toBe(3);
  });
});

describe("FORMAL_DRAW_DEFAULTS", () => {
  it("pins the interactive tools to architect strokes and mono text", () => {
    expect(FORMAL_DRAW_DEFAULTS.currentItemRoughness).toBe(0);
    expect(FORMAL_DRAW_DEFAULTS.currentItemFontFamily).toBe(3);
    expect(FORMAL_DRAW_DEFAULTS.currentItemStrokeStyle).toBe("solid");
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
  it("keeps only durable appState and no in-blob version", () => {
    const elements = buildIconInsertion(LAMBDA, 0, 0).elements;
    const snap = sceneToSnapshot(elements, {
      viewBackgroundColor: "#fafafa",
      gridSize: 20,
      gridModeEnabled: true,
      // transient view state — must not persist
      scrollX: 999,
      scrollY: 888,
    });

    expect(snap.appState).toEqual({
      viewBackgroundColor: "#fafafa",
      gridSize: 20,
      gridModeEnabled: true,
    });
    // Version rides on the board row, never inside the blob.
    expect("version" in snap).toBe(false);
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
    const scene = snapshotToScene(snap, SNAPSHOT_VERSION);
    expect(scene.elements.map((e) => e.type)).toEqual(["image", "text"]);
    expect(scene.files[iconFileId(LAMBDA)]).toBeDefined();
  });

  it("loads a board whose snapshot_version is not this build's as blank", () => {
    expect(snapshotToScene({ elements: [{ type: "image" }] }, 1).elements).toHaveLength(0);
    expect(snapshotToScene({ elements: [{ type: "image" }] }, 99).elements).toHaveLength(0);
  });

  it("loads a malformed or empty blob as a blank canvas", () => {
    expect(snapshotToScene({ store: {}, schema: {} }, SNAPSHOT_VERSION).elements).toHaveLength(0);
    expect(snapshotToScene({}, SNAPSHOT_VERSION).elements).toHaveLength(0);
    expect(snapshotToScene(null, SNAPSHOT_VERSION).appState).toEqual(DEFAULT_APP_STATE);
  });
});

describe("TOOL_MAP", () => {
  it("maps every canvas tool to a non-empty Excalidraw tool", () => {
    for (const tool of Object.values(TOOL_MAP)) {
      expect(tool.length).toBeGreaterThan(0);
    }
  });

  it("maps the rail's tools", () => {
    expect(TOOL_MAP.select).toBe("selection");
    expect(TOOL_MAP.draw).toBe("freedraw");
    expect(TOOL_MAP.frame).toBe("frame");
    expect(TOOL_MAP.rectangle).toBe("rectangle");
  });
});

describe("toolForShortcut", () => {
  it("maps the eraser.io keys", () => {
    expect(toolForShortcut("v")).toBe("select");
    expect(toolForShortcut("h")).toBe("hand");
    expect(toolForShortcut("e")).toBe("eraser");
    expect(toolForShortcut("t")).toBe("text");
    expect(toolForShortcut("r")).toBe("rectangle");
    expect(toolForShortcut("o")).toBe("ellipse");
    expect(toolForShortcut("a")).toBe("arrow");
    expect(toolForShortcut("l")).toBe("line");
    expect(toolForShortcut("f")).toBe("frame");
  });

  it("maps d to draw, overriding Excalidraw's diamond binding", () => {
    expect(toolForShortcut("d")).toBe("draw");
  });

  it("is case-insensitive and null for unmapped keys", () => {
    expect(toolForShortcut("V")).toBe("select");
    expect(toolForShortcut("z")).toBeNull();
    expect(toolForShortcut("1")).toBeNull();
  });
});

describe("railToolForCanvasTool", () => {
  it("returns the rail tool for rail tools", () => {
    expect(railToolForCanvasTool("select")).toBe("select");
    expect(railToolForCanvasTool("draw")).toBe("draw");
  });

  it("returns null for palette-only tools", () => {
    expect(railToolForCanvasTool("rectangle")).toBeNull();
    expect(railToolForCanvasTool("ellipse")).toBeNull();
  });
});

describe("iconLabel", () => {
  it("prefixes the family for a bare name", () => {
    expect(iconLabel("logos:aws-lambda")).toBe("AWS Lambda");
  });

  it("does not repeat a family already in the name", () => {
    expect(iconLabel("logos:aws")).toBe("AWS Cloud");
  });
});
