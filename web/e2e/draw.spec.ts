import { expect, login, newDrawBoard, test } from "./fixtures";

// Excalidraw 0.18 logs two known warnings before/while it mounts (an App
// setState warning and Chrome's unload permissions-policy notice). They are
// not our bugs, but a real console error still fails the run.
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
