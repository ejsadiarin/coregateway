// Frame-time check for Draw on a large board (issue #39).
//
// Creates a throwaway board with 600 elements (including long freehand
// strokes), then measures requestAnimationFrame deltas while panning and while
// drawing on it, against an empty board on the same stack.
//
//   scripts/e2e-up.sh
//   cd web && node scripts/measure-draw-frame-times.mjs
//
// Override the defaults with E2E_BASE_URL / E2E_API_URL / E2E_ADMIN_EMAIL /
// E2E_ADMIN_PASSWORD. Results print as a small table; nothing is asserted
// because headless frame times depend on the host.

import { chromium } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const API = process.env.E2E_API_URL ?? BASE.replace(/:3001$/, ":18080");
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@e2e.local";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-pass-123";

function baseElement(id, x, y, width, height) {
  return {
    id,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
    customData: undefined,
  };
}

function rectangle(id, x, y) {
  return { ...baseElement(id, x, y, 40, 30), type: "rectangle", roundness: { type: 3 } };
}

function longStroke(id, x, y, length) {
  const points = [];
  const pressures = [];
  for (let i = 0; i < length; i++) {
    points.push([i * 6, Math.sin(i / 3) * 14]);
    pressures.push(0.5);
  }
  return {
    ...baseElement(id, x, y, (length - 1) * 6, 28),
    type: "freedraw",
    points,
    pressures,
    simulatePressure: false,
    lastCommittedPoint: null,
  };
}

function heavyScene() {
  const elements = [];
  for (let row = 0; row < 25; row++) {
    for (let col = 0; col < 22; col++) {
      elements.push(rectangle(`rect-${row}-${col}`, col * 48, row * 48));
    }
  }
  for (let i = 0; i < 50; i++) {
    const row = i % 20;
    const col = i % 15;
    elements.push(longStroke(`stroke-${i}`, 5 + col * 70, 8 + row * 58, 40));
  }
  return elements;
}

async function createBoard(request, title, elements) {
  const created = await request.post(`${API}/api/coredraw/boards`, { data: { title } });
  if (!created.ok()) throw new Error(`create board: ${created.status()}`);
  const board = await created.json();
  const saved = await request.put(`${API}/api/coredraw/boards/${board.id}`, {
    data: {
      snapshot: { elements, appState: { viewBackgroundColor: "#ffffff", gridSize: 20, gridModeEnabled: false } },
      snapshot_version: 2,
      doc: "",
      revision: board.revision,
    },
  });
  if (!saved.ok()) throw new Error(`save board: ${saved.status()}`);
  return board.id;
}

async function openBoard(page, id) {
  await page.goto(`${BASE}/dashboard/draw/${id}`);
  await page.locator(".coredraw-canvas").waitFor({ state: "visible" });
  await page.waitForTimeout(1200); // let Excalidraw settle its initial view
}

async function startFrames(page) {
  await page.evaluate(() => {
    globalThis.__drawFrames = [];
    globalThis.__drawRecording = true;
    let last = performance.now();
    const loop = (now) => {
      if (!globalThis.__drawRecording) return;
      globalThis.__drawFrames.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function stopFrames(page) {
  const frames = await page.evaluate(() => {
    globalThis.__drawRecording = false;
    return globalThis.__drawFrames;
  });
  const useful = frames.slice(4).sort((a, b) => a - b);
  const at = (q) => useful[Math.min(useful.length - 1, Math.floor(useful.length * q))] ?? 0;
  return {
    frames: useful.length,
    p50: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +(useful.at(-1) ?? 0).toFixed(1),
  };
}

async function panAcross(page) {
  const box = await page.locator(".coredraw-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx + Math.sin(i / 7) * 140, cy + Math.sin(i / 5) * 90);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function drawAcross(page) {
  const box = await page.locator(".coredraw-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 160, cy - 60);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(cx - 160 + i * 5, cy - 60 + Math.sin(i / 6) * 80);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function measure(page, label, selectTool, action) {
  await selectTool();
  await startFrames(page);
  await action();
  return { label, ...(await stopFrames(page)) };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Access System" }).click();
  await page.waitForURL("**/dashboard");

  const empty = await createBoard(page.request, `perf empty ${Date.now()}`, []);
  const heavy = await createBoard(page.request, `perf heavy ${Date.now()}`, heavyScene());

  const results = [];
  for (const [name, id] of [
    ["empty", empty],
    ["600 elements", heavy],
  ]) {
    await openBoard(page, id);
    const board = await (await page.request.get(`${API}/api/coredraw/boards/${id}`)).json();
    const elementCount = board.snapshot?.elements?.length ?? 0;
    const rail = page.getByTestId("draw-tool-rail");
    results.push(
      await measure(page, `${name} · pan`, () => rail.getByRole("button", { name: "Pan" }).click(), () =>
        panAcross(page),
      ),
    );
    results.push(
      await measure(page, `${name} · draw`, () => rail.getByRole("button", { name: "Draw" }).click(), () =>
        drawAcross(page),
      ),
    );
    console.log(`opened ${name}: ${elementCount} stored elements`);
  }

  console.log("\nDraw frame times (requestAnimationFrame delta, ms)\n");
  console.log("scenario            frames    p50    p95    max");
  for (const r of results) {
    const cells = [r.label.padEnd(18), r.frames, r.p50, r.p95, r.max].map((v) =>
      String(v).padStart(6),
    );
    console.log(cells.join(""));
  }
} finally {
  await browser.close();
}
