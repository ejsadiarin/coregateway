import { expect, login, newDrawBoard, test } from "./fixtures";

// Excalidraw 0.18 logs two known warnings before/while it mounts (an App
// setState warning and Chrome's unload permissions-policy notice). They are
// not our bugs, but a real console error still fails the run.
// sync.ts debounces saves for 1500ms. Waiting a little longer proves that a
// view-only change did not arm one.
const SAVE_SETTLE_MS = 1800;

function dropExcalidrawNoise(errors: string[]) {
  const known = [
    /Can't call %s on a component that is not yet mounted/,
    /Permissions policy violation: unload is not allowed/,
  ];
  for (let i = errors.length - 1; i >= 0; i--) {
    if (known.some((pattern) => pattern.test(errors[i]))) errors.splice(i, 1);
  }
}

test.describe("draw phone shell", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("fills the screen, hides dashboard chrome and reaches every tool", async ({ page, consoleErrors }) => {
    await login(page);
    await newDrawBoard(page, "phone shell");

    // The dashboard's own chrome is gone while the editor is open.
    await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Color scheme" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Boards" })).toBeVisible();

    // Notes start closed so the canvas gets the screen.
    await expect(page.getByPlaceholder(/Board notes in markdown/)).toHaveCount(0);

    // The bottom toolbar is the only visible tool rail, and every tool fits
    // on screen without a swipe.
    const tools = ["Select", "Pan", "Draw", "Eraser", "Text", "Arrow", "Line", "Frame"];
    for (const name of tools) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    }
    await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeVisible();

    // Switching tools updates the pressed state without touching Excalidraw's
    // hidden toolbar. Frame and Insert prove the far end of the bar is reachable.
    for (const name of ["Draw", "Frame", "Select"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(page.getByPlaceholder("Search icons…")).toBeVisible();
    await page.getByRole("button", { name: "Close panel" }).click();

    // Clean, PNG and SVG moved into the overflow menu.
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: /Clean/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /PNG/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /SVG/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: /Clean/ })).toHaveCount(0);

    // The page itself does not scroll or rubber-band around the canvas, and
    // double-tap zoom is disabled everywhere outside the canvas.
    const metrics = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>("[data-draw-editor]");
      const toolbarButton = document.querySelector<HTMLElement>("[data-draw-toolbar] button");
      return {
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        overscroll: editor ? getComputedStyle(editor).overscrollBehaviorY : "",
        editorTouchAction: editor ? getComputedStyle(editor).touchAction : "",
        toolbarTouchAction: toolbarButton ? getComputedStyle(toolbarButton).touchAction : "",
      };
    });
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.overscroll).toBe("none");
    expect(metrics.editorTouchAction).toBe("manipulation");
    expect(metrics.toolbarTouchAction).toBe("manipulation");
    dropExcalidrawNoise(consoleErrors);
  });
});

test("saves a drawn stroke once and never on pan, zoom or selection", async ({ page, consoleErrors }) => {
  await login(page);

  // Count every board save, including one that opening a board might trigger.
  const saves: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && /\/api\/coredraw\/boards\//.test(request.url())) {
      saves.push(request.url());
    }
  });

  await newDrawBoard(page, "change detection");
  const canvas = page.locator(".coredraw-canvas");
  await expect(canvas).toBeVisible();
  const rail = page.getByTestId("draw-tool-rail");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no box");
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 };

  async function drag(to: { x: number; y: number }) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
  }

  // Opening a board only adopts a baseline; it never schedules a save.
  await page.waitForTimeout(SAVE_SETTLE_MS + 200);
  expect(saves).toHaveLength(0);

  // Pan, zoom and selection are view-only.
  await rail.getByRole("button", { name: "Pan", exact: true }).click();
  await drag({ x: from.x + 120, y: from.y + 80 });
  await page.keyboard.down("Control");
  await page.mouse.move(from.x, from.y);
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await rail.getByRole("button", { name: "Select", exact: true }).click();
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(SAVE_SETTLE_MS);
  expect(saves).toHaveLength(0);

  // One drawn stroke schedules exactly one debounced save.
  await rail.getByRole("button", { name: "Draw", exact: true }).click();
  await drag({ x: from.x + 220, y: from.y + 40 });
  await expect.poll(() => saves.length, { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(SAVE_SETTLE_MS);
  expect(saves).toHaveLength(1);

  // View changes on the loaded board add nothing.
  await rail.getByRole("button", { name: "Select", exact: true }).click();
  await page.mouse.click(from.x + 100, from.y + 100);
  await rail.getByRole("button", { name: "Pan", exact: true }).click();
  await drag({ x: from.x + 40, y: from.y + 30 });
  await page.waitForTimeout(SAVE_SETTLE_MS);
  expect(saves).toHaveLength(1);

  // Reopening a board with content must not save (the mount rewrite is not an
  // edit), and the first stroke after it must still be saved.
  await page.reload();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(SAVE_SETTLE_MS + 200);
  expect(saves).toHaveLength(1);

  await rail.getByRole("button", { name: "Draw", exact: true }).click();
  await drag({ x: from.x + 180, y: from.y + 120 });
  await expect.poll(() => saves.length, { timeout: 5000 }).toBe(2);

  // A pending debounce must not save a stroke that is still being drawn: draw
  // one stroke, immediately start a second slow one, and hold past 1500ms.
  await drag({ x: from.x + 140, y: from.y + 150 });
  const held = { x: from.x + 60, y: from.y + 60 };
  await page.mouse.move(held.x, held.y);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(held.x + i * 4, held.y + i * 2);
    await page.waitForTimeout(100);
  }
  expect(saves).toHaveLength(2);
  await page.mouse.up();
  await expect.poll(() => saves.length, { timeout: 5000 }).toBe(3);
  await page.waitForTimeout(SAVE_SETTLE_MS);
  expect(saves).toHaveLength(3);

  dropExcalidrawNoise(consoleErrors);
});

test.describe("draw tablet and desktop shell", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("keeps the side rail and dashboard chrome", async ({ page, consoleErrors }) => {
    await login(page);
    await newDrawBoard(page, "tablet shell");

    await expect(page.getByText("CORE SYSTEM")).toBeVisible();
    await expect(page.getByRole("button", { name: "Color scheme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select", exact: true })).toBeVisible();
    await expect(page.getByTestId("draw-mobile-toolbar")).toBeHidden();
    await expect(page.getByRole("link", { name: "Boards" })).toBeVisible();
    // The desktop top bar keeps its direct actions instead of the overflow.
    for (const name of ["Clean", "PNG", "SVG"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Hide notes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    dropExcalidrawNoise(consoleErrors);
  });
});
