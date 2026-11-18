import { readFile } from "node:fs/promises";
import { API_URL, expect, login, newDrawBoard, test } from "./fixtures";

// Excalidraw 0.18 under React 19 logs a few known warnings (an App setState
// warning, Chrome's unload permissions-policy notice, and an update-inside-
// update notice on pen detection). They are not our bugs, but a real console
// error still fails the run.
// sync.ts debounces saves for 1500ms. Waiting a little longer proves that a
// view-only change did not arm one.
const SAVE_SETTLE_MS = 1800;

function dropExcalidrawNoise(errors: string[]) {
  const known = [
    /Can't call %s on a component that is not yet mounted/,
    /Permissions policy violation: unload is not allowed/,
    /scheduled from inside an update function/,
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
    for (const name of ["Undo", "Redo", "Zoom out", "Zoom in", "Zoom to fit"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("button", { name: /reset to 100%/ })).toBeVisible();
    await expect(page.getByTestId("button-undo")).toBeHidden();
    await expect(page.getByTestId("button-redo")).toBeHidden();

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
  test.setTimeout(45_000);
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

test("undo, redo and zoom stay in our own controls", async ({ page, consoleErrors }) => {
  await login(page);
  await newDrawBoard(page, "history controls");
  const boardId = page.url().split("/").pop();
  if (!boardId) throw new Error("board id missing");
  const savedElements = async () => {
    const res = await page.request.get(`${API_URL}/api/coredraw/boards/${boardId}`);
    const saved = await res.json();
    return (saved.snapshot?.elements ?? []) as { type: string }[];
  };

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  const zoomLabel = page.getByRole("button", { name: /reset to 100%/ });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(zoomLabel).toHaveText("100%");

  // Zoom-to-fit on an empty board resets instead of breaking.
  await page.getByRole("button", { name: "Zoom to fit", exact: true }).click();
  await expect(zoomLabel).toHaveText("100%");

  // Draw a stroke, then undo and redo it through our controls.
  const canvas = page.locator(".coredraw-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.getByTestId("draw-tool-rail").getByRole("button", { name: "Draw", exact: true }).click();
  const x = box.x + box.width * 0.35;
  const y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 180, y + 80, { steps: 20 });
  await page.mouse.up();

  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await expect.poll(async () => (await savedElements()).some((el) => el.type === "freedraw")).toBe(false);

  await redo.click();
  await expect(undo).toBeEnabled();
  await expect.poll(async () => (await savedElements()).some((el) => el.type === "freedraw")).toBe(true);

  // Excalidraw's keyboard shortcuts still work alongside our buttons when the
  // canvas has focus.
  await page.getByTestId("draw-tool-rail").getByRole("button", { name: "Select", exact: true }).click();
  await page.mouse.click(box.x + 40, box.y + 40);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedElements()).some((el) => el.type === "freedraw")).toBe(false);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await savedElements()).some((el) => el.type === "freedraw")).toBe(true);

  // An app-driven style change is undoable too.
  await page.keyboard.press("Control+a");
  await page
    .getByRole("group", { name: "Stroke" })
    .getByRole("button", { name: "Blue", exact: true })
    .click();
  await expect
    .poll(async () => {
      const elements = await savedElements();
      return (elements.find((el) => el.type === "freedraw") as { strokeColor?: string } | undefined)
        ?.strokeColor;
    })
    .toBe("#2563eb");
  await undo.click();
  await expect
    .poll(async () => {
      const elements = await savedElements();
      return (elements.find((el) => el.type === "freedraw") as { strokeColor?: string } | undefined)
        ?.strokeColor;
    })
    .toBe("#1e1e1e");

  // Zoom in/out and reset update the readout.
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(zoomLabel).toHaveText("91%");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(zoomLabel).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(zoomLabel).toHaveText("110%");
  await zoomLabel.click();
  await expect(zoomLabel).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(zoomLabel).toHaveText("110%");
  await page.getByRole("button", { name: "Zoom to fit", exact: true }).click();
  await expect(zoomLabel).toHaveText("100%");

  dropExcalidrawNoise(consoleErrors);
});

test("canvas follows the app theme, exports stay light and the top bar is stable", async ({
  page,
  consoleErrors,
}) => {
  test.setTimeout(60_000);
  await login(page);
  await newDrawBoard(page, "theme polish");
  const root = page.locator(".coredraw-canvas .excalidraw");
  const canvasFilter = () =>
    page.locator(".coredraw-canvas canvas").first().evaluate((el) => getComputedStyle(el).filter);
  await expect(root).toHaveClass(/theme--dark/);
  expect(await canvasFilter()).toContain("invert");

  const canvas = page.locator(".coredraw-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const draw = async () => {
    await page.getByTestId("draw-tool-rail").getByRole("button", { name: "Draw", exact: true }).click();
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 160, y + 60, { steps: 15 });
    await page.mouse.up();
  };

  // The save status has a fixed slot, so the bar does not shift while saving.
  const status = page.getByRole("status").filter({ hasText: /Saved|Saving/ });
  await expect(status).toHaveText(/Saved · rev/);
  const cleanBox = await page.getByRole("button", { name: "Clean", exact: true }).boundingBox();
  const statusBox = await status.boundingBox();
  await draw();
  await expect(status).toHaveText(/Saving|Saved/);
  expect((await status.boundingBox())?.width).toBe(statusBox?.width);
  expect((await status.boundingBox())?.x).toBe(statusBox?.x);
  expect((await page.getByRole("button", { name: "Clean", exact: true }).boundingBox())?.x).toBe(
    cleanBox?.x,
  );
  await expect(status).toHaveText(/Saved · rev \d+/);

  // The canvas follows the runtime theme, including while a board is open.
  await page.getByRole("button", { name: "Color scheme" }).click();
  await page.getByRole("menuitem", { name: /Warm Paper/ }).click();
  await expect(root).not.toHaveClass(/theme--dark/);
  expect(await canvasFilter()).toBe("none");
  await page.getByRole("button", { name: "Color scheme" }).click();
  await page.getByRole("menuitem", { name: /Ember Craft/ }).click();
  await expect(root).toHaveClass(/theme--dark/);
  expect(await canvasFilter()).toContain("invert");

  // Exporting from the dark canvas keeps the light board background.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "SVG", exact: true }).click(),
  ]);
  const file = await download.path();
  if (!file) throw new Error("no downloaded svg");
  const svg = await readFile(file, "utf8");
  expect(svg).toContain("#ffffff");
  expect(svg).not.toContain("#141110");

  dropExcalidrawNoise(consoleErrors);
});

test("shows an editor skeleton while a board opens", async ({ page, consoleErrors }) => {
  await login(page);
  await page.goto("/dashboard/draw");
  await page.route("**/api/coredraw/boards/*", async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.continue();
  });
  await page.getByLabel("New board title").fill(`skeleton ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "New board" }).click();
  const skeleton = page.getByRole("status", { name: "Opening board" });
  await expect(skeleton).toBeVisible();
  await expect(page.getByRole("link", { name: "Boards" })).toBeVisible({ timeout: 10_000 });
  await expect(skeleton).toHaveCount(0);
  await expect(page.locator(".coredraw-canvas")).toBeVisible();
  dropExcalidrawNoise(consoleErrors);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("collapses editor animations", async ({ page, consoleErrors }) => {
    await login(page);
    await newDrawBoard(page, "reduced motion");
    const draw = page.getByTestId("draw-tool-rail").getByRole("button", { name: "Draw", exact: true });
    const durations = await draw.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        transition: parseFloat(style.transitionDuration),
        animation: parseFloat(style.animationDuration),
      };
    });
    expect(durations.transition).toBeLessThanOrEqual(0.01);
    expect(durations.animation).toBeLessThanOrEqual(0.01);
    dropExcalidrawNoise(consoleErrors);
  });
});

test.describe("draw phone sheets", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("inserts an icon, restyles, saves notes and dismisses sheets", async ({ page, consoleErrors }) => {
    test.setTimeout(60_000);
    await login(page);
    await newDrawBoard(page, "phone sheets");
    const boardId = page.url().split("/").pop();
    if (!boardId) throw new Error("board id missing");
    const board = async () =>
      (await page.request.get(`${API_URL}/api/coredraw/boards/${boardId}`)).json();
    const canvas = page.locator(".coredraw-canvas");
    const canvasBox = async () => {
      const box = await canvas.boundingBox();
      if (!box) throw new Error("no canvas");
      return box;
    };
    const initialCanvas = await canvasBox();

    // Palette sheet: search, insert, and close so the element is visible.
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    const search = page.getByPlaceholder("Search icons…");
    await expect(search).toBeVisible();
    // A tap opens without raising the keyboard; sheets overlay the canvas
    // instead of shrinking it.
    await expect(search).not.toBeFocused();
    expect((await canvasBox()).width).toBe(initialCanvas.width);
    expect((await canvasBox()).height).toBe(initialCanvas.height);

    // The sheet handle follows theme tokens and the workspace radius rather
    // than vaul's hardcoded near-white handle.
    const sheetChrome = await page.locator(".coredraw-draw-handle").evaluate((el) => {
      const handle = getComputedStyle(el);
      const content = getComputedStyle(el.closest('[role="dialog"]') as Element);
      return {
        height: handle.height,
        width: handle.width,
        background: handle.backgroundColor,
        radius: content.borderTopLeftRadius,
      };
    });
    expect(sheetChrome.height).toBe("4px");
    expect(sheetChrome.width).toBe("40px");
    expect(sheetChrome.background).not.toBe("rgb(226, 226, 228)");
    expect(sheetChrome.radius).toBe("12px");

    await search.fill("lambda");
    await page.getByRole("button", { name: "Lambda", exact: true }).click();
    await expect(search).toHaveCount(0);
    await expect
      .poll(async () => {
        const saved = await board();
        return (saved.snapshot?.elements ?? []).some(
          (el: { type: string; customData?: { iconId?: string } }) =>
            el.type === "image" && el.customData?.iconId === "logos:aws-lambda",
        );
      })
      .toBe(true);

    // Style sheet: the toolbar dot follows the choice and new strokes use it.
    const blueStroke = page
      .getByRole("group", { name: "Stroke colour" })
      .getByRole("button", { name: "Blue", exact: true });
    const styleButton = page.getByRole("button", { name: "Style", exact: true });
    await styleButton.click();
    await blueStroke.click();
    expect((await canvasBox()).height).toBe(initialCanvas.height);
    await page.keyboard.press("Escape");
    await expect(blueStroke).toHaveCount(0);
    await expect
      .poll(() => styleButton.locator("span").evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(37, 99, 235)");

    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const box = await canvasBox();
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.45;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 180, y + 60, { steps: 20 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const saved = await board();
        const strokes = (saved.snapshot?.elements ?? []).filter(
          (el: { type: string }) => el.type === "freedraw",
        );
        return strokes.at(-1)?.strokeColor;
      })
      .toBe("#2563eb");

    // Styling a selection (select all) updates the existing stroke.
    await page.keyboard.press("Control+a");
    await styleButton.click();
    await page
      .getByRole("group", { name: "Stroke colour" })
      .getByRole("button", { name: "Green", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const saved = await board();
        const strokes = (saved.snapshot?.elements ?? []).filter(
          (el: { type: string }) => el.type === "freedraw",
        );
        return strokes.at(-1)?.strokeColor;
      })
      .toBe("#16a34a");

    // Notes sheet: editing still rides the board save.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Show notes" }).click();
    const notes = page.getByPlaceholder(/Board notes in markdown/);
    await expect(notes).toBeVisible();
    expect((await canvasBox()).width).toBe(initialCanvas.width);
    expect((await canvasBox()).height).toBe(initialCanvas.height);
    await notes.fill("note from the phone sheet");
    await expect.poll(async () => (await board()).doc).toBe("note from the phone sheet");
    await page.keyboard.press("Escape");
    await expect(notes).toHaveCount(0);

    // Opening another sheet, then Escape and an overlay tap both dismiss.
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(search).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await styleButton.click();
    await expect(blueStroke).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(blueStroke).toHaveCount(0);

    // Swiping the handle down dismisses too.
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(search).toBeVisible();
    const handle = page.locator(".coredraw-draw-handle");
    const hb = await handle.boundingBox();
    if (!hb) throw new Error("no sheet handle");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 280, { steps: 20 });
    await page.mouse.up();
    await expect(search).toHaveCount(0);

    // `/` opens the sheet from the keyboard with search focused.
    await page.keyboard.press("/");
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);

    dropExcalidrawNoise(consoleErrors);
  });
});

test.describe("draw pen mode", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("detects a stylus, separates pen from fingers and toggles", async ({ page, consoleErrors }) => {
    test.setTimeout(60_000);
    await login(page);
    await newDrawBoard(page, "pen mode");
    const boardId = page.url().split("/").pop();
    if (!boardId) throw new Error("board id missing");
    const savedStrokes = async () => {
      const res = await page.request.get(`${API_URL}/api/coredraw/boards/${boardId}`);
      const saved = await res.json();
      return (saved.snapshot?.elements ?? []).filter(
        (el: { type: string }) => el.type === "freedraw",
      ).length;
    };
    const canvas = page.locator(".coredraw-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas");
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height * 0.4;

    const cdp = await page.context().newCDPSession(page);
    const pen = async (type: "mousePressed" | "mouseMoved" | "mouseReleased", px: number, py: number) => {
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        x: px,
        y: py,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
        pointerType: "pen",
        force: type === "mouseReleased" ? 0 : 0.7,
      });
    };
    const touch = async (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]) => {
      await cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
      });
    };
    const touchDrag = async (dx: number, dy: number) => {
      await touch("touchStart", [{ x, y }]);
      for (let i = 1; i <= 20; i++) {
        await touch("touchMove", [{ x: x + (dx * i) / 20, y: y + (dy * i) / 20 }]);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd", []);
    };

    // The toggle only exists once a pen has been detected.
    const penToggle = page.getByRole("button", { name: "Pen mode", exact: true });
    await expect(penToggle).toHaveCount(0);

    // A stylus tap is detected by Excalidraw and turns pen mode on itself.
    await pen("mousePressed", x, y);
    await pen("mouseReleased", x, y);
    await expect(penToggle).toBeVisible();
    await expect(penToggle).toHaveAttribute("aria-pressed", "true");

    // A stylus stroke draws with a drawing tool active.
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await pen("mousePressed", x, y);
    for (let i = 1; i <= 20; i++) {
      await pen("mouseMoved", x + i * 5, y + Math.sin(i / 3) * 30);
      await page.waitForTimeout(16);
    }
    await pen("mouseReleased", x + 100, y + 20);
    await expect.poll(savedStrokes, { timeout: 5000 }).toBe(1);

    // With pen mode on, a finger drag pans and a two-finger pinch zooms,
    // without adding any ink.
    const beforePan = await canvas.screenshot();
    await touchDrag(120, 60);
    await expect.poll(async () => (await canvas.screenshot()).equals(beforePan)).toBe(false);

    const zoomLabel = page.getByRole("button", { name: /reset to 100%/ });
    await expect(zoomLabel).toHaveText("100%");
    await touch("touchStart", [
      { x: x - 30, y },
      { x: x + 30, y },
    ]);
    await touch("touchMove", [
      { x: x - 70, y },
      { x: x + 70, y },
    ]);
    await touch("touchEnd", []);
    await expect(zoomLabel).not.toHaveText("100%");
    await page.waitForTimeout(SAVE_SETTLE_MS);
    expect(await savedStrokes()).toBe(1);

    // Turning it off lets a finger draw with the active tool.
    await penToggle.click();
    await expect(penToggle).toHaveAttribute("aria-pressed", "false");
    await touchDrag(160, 80);
    await expect.poll(savedStrokes, { timeout: 5000 }).toBe(2);

    dropExcalidrawNoise(consoleErrors);
  });
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
    for (const name of ["Undo", "Redo", "Zoom out", "Zoom in", "Zoom to fit"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /reset to 100%/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByTestId("button-undo")).toBeHidden();
    await expect(page.getByTestId("button-redo")).toBeHidden();
    dropExcalidrawNoise(consoleErrors);
  });
});
