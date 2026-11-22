// Renders the PNG app icons from public/icon.svg (`pnpm icons:pwa`).
// Run it again after changing the SVG; the PNGs are committed.
//
// - icon-192/512: the SVG as drawn (rounded square), "any" purpose.
// - icon-maskable-512 and apple-touch-icon: full-bleed square. Android masks
//   it to the launcher's shape and iOS rounds it itself; the artwork already
//   sits inside the maskable safe zone (radius 40% of the icon).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const publicDir = path.resolve(import.meta.dirname, "../public");
const svg = fs.readFileSync(path.join(publicDir, "icon.svg"), "utf8");
const fullBleed = svg.replace(/(<rect[^>]*?)\s+rx="[^"]*"/, "$1");

const outputs = [
  { file: "icon-192.png", size: 192, source: svg },
  { file: "icon-512.png", size: 512, source: svg },
  { file: "icon-maskable-512.png", size: 512, source: fullBleed },
  { file: "apple-touch-icon.png", size: 180, source: fullBleed },
];

const browser = await chromium.launch();
try {
  for (const { file, size, source } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = source.replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    await page.screenshot({
      path: path.join(publicDir, file),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    console.log(`wrote public/${file}`);
  }
} finally {
  await browser.close();
}
