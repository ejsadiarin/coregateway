import { describe, expect, it } from "vitest";
import {
  checkEncodedImage,
  checkPoster,
  fitWithin,
  MAX_IMAGE_BYTES,
  MAX_POSTER_BYTES,
  MAX_VIDEO_BYTES,
  planFile,
  roomFor,
} from "./attachments";

const MB = 1 << 20;
const file = (type: string, size = MB, name = "x") => ({ type, size, name });

describe("planFile", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("re-encodes %s to WebP, whatever its size", (type) => {
    expect(planFile(file(type, 40 * MB))).toEqual({ action: "encode" });
  });

  it("keeps a GIF as it is", () => {
    expect(planFile(file("image/gif", 4 * MB))).toEqual({ action: "keep", kind: "image", contentType: "image/gif" });
  });

  it("refuses a GIF over 5 MB", () => {
    const plan = planFile(file("image/gif", MAX_IMAGE_BYTES + 1));
    expect(plan.action).toBe("refuse");
    expect(plan.action === "refuse" && plan.reason).toMatch(/5 MB/);
  });

  it("refuses HEIC with a clear message", () => {
    for (const f of [file("image/heic"), file("image/heif"), file("", MB, "IMG_0001.HEIC")]) {
      const plan = planFile(f);
      expect(plan.action).toBe("refuse");
      expect(plan.action === "refuse" && plan.reason).toMatch(/HEIC/);
    }
  });

  it.each([
    ["video/mp4", "video/mp4"],
    ["video/webm", "video/webm"],
    ["video/quicktime", "video/quicktime"],
  ])("keeps a %s video as it is", (type, contentType) => {
    expect(planFile(file(type, 20 * MB))).toEqual({ action: "keep", kind: "video", contentType });
  });

  it("reads a video's type from its name when the browser gives none", () => {
    expect(planFile(file("", MB, "clip.MOV"))).toEqual({ action: "keep", kind: "video", contentType: "video/quicktime" });
    expect(planFile(file("", MB, "clip.mp4"))).toEqual({ action: "keep", kind: "video", contentType: "video/mp4" });
  });

  it("refuses a video over 25 MB, and at exactly 25 MB keeps it", () => {
    expect(planFile(file("video/mp4", MAX_VIDEO_BYTES)).action).toBe("keep");
    const plan = planFile(file("video/mp4", MAX_VIDEO_BYTES + 1));
    expect(plan.action === "refuse" && plan.reason).toMatch(/25 MB/);
  });

  it("refuses anything else, and an empty file", () => {
    expect(planFile(file("application/pdf")).action).toBe("refuse");
    expect(planFile(file("video/x-matroska")).action).toBe("refuse");
    expect(planFile(file("image/png", 0)).action).toBe("refuse");
  });
});

describe("checkEncodedImage", () => {
  it("accepts WebP up to 5 MB", () => {
    expect(checkEncodedImage({ type: "image/webp", size: MAX_IMAGE_BYTES })).toBeNull();
  });

  it("refuses WebP still over 5 MB once encoded", () => {
    expect(checkEncodedImage({ type: "image/webp", size: MAX_IMAGE_BYTES + 1 })).toMatch(/5 MB/);
  });

  it("refuses a browser that can't encode WebP (it hands back PNG)", () => {
    expect(checkEncodedImage({ type: "image/png", size: MB })).toMatch(/WebP/);
  });
});

describe("checkPoster", () => {
  it("takes a WebP poster up to 1 MB", () => {
    expect(checkPoster({ type: "image/webp", size: MAX_POSTER_BYTES })).toBe(true);
    expect(checkPoster({ type: "image/webp", size: MAX_POSTER_BYTES + 1 })).toBe(false);
    expect(checkPoster({ type: "image/png", size: 10 })).toBe(false);
  });
});

describe("fitWithin", () => {
  it("scales the longer side down to the limit, keeping the shape", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1000, 5000, 2048)).toEqual({ width: 410, height: 2048 });
  });

  it("leaves a smaller image as it is", () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
});

describe("roomFor", () => {
  it("lets a note hold at most 10", () => {
    expect(roomFor(0, 3)).toEqual({ take: 3, dropped: 0 });
    expect(roomFor(8, 5)).toEqual({ take: 2, dropped: 3 });
    expect(roomFor(10, 1)).toEqual({ take: 0, dropped: 1 });
  });
});
