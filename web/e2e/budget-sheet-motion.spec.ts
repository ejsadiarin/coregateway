import { expect, login, test, type Page } from "./fixtures";

// The record sheet (coregateway#57): on a phone the whole card follows a
// drag down and a long enough drag dismisses it; on a wider screen only the
// handle drags, and the card fades in and out where it stands.

test.beforeEach(async ({ page }) => {
  await login(page);
});

const openSheet = async (page: Page) => {
  await page.goto("/dashboard/budget/expenses");
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New expense" });
  await expect(sheet).toBeVisible();
  // vaul refuses drags while the sheet is still sliding in.
  await page.waitForTimeout(600);
  return sheet;
};

// drag presses at (x, y) and moves the pointer down by `by` in steps.
const drag = async (page: Page, x: number, y: number, by: number, release = true) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, y + (by * i) / 10);
    await page.waitForTimeout(16);
  }
  if (release) await page.mouse.up();
};

// watchEntrance records, frame by frame from the first one, how far the sheet
// sits from its resting place and its opacity.
const watchEntrance = async (page: Page) => {
  await page.goto("/dashboard/budget/expenses");
  const open = page.getByRole("button", { name: "Expense", exact: true });
  await expect(open).toBeVisible();
  await page.evaluate(() => {
    const frames: { y: number; opacity: number }[] = [];
    Object.assign(window, { sheetFrames: frames });
    const tick = () => {
      const el = document.querySelector(".bottom-sheet");
      if (el) {
        const style = getComputedStyle(el);
        frames.push({ y: new DOMMatrix(style.transform).m42, opacity: Number(style.opacity) });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await open.click();
  await page.waitForTimeout(900);
  return page.evaluate(() => (window as unknown as { sheetFrames: { y: number; opacity: number }[] }).sheetFrames);
};

test.describe("on a phone", () => {
  test.use({ viewport: { width: 412, height: 900 } });

  test("the sheet slides up from the bottom", async ({ page }) => {
    const frames = await watchEntrance(page);
    expect(Math.max(...frames.map((f) => f.y))).toBeGreaterThan(300);
    expect(frames.at(-1)!.y).toBe(0);
  });

  test("dragging the card down far enough dismisses it; a short drag springs back", async ({ page }) => {
    const sheet = await openSheet(page);
    const box = (await sheet.boundingBox())!;

    // A short, slow drag: the sheet stays.
    await page.mouse.move(box.x + box.width / 2, box.y + 120);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + 120 + i * 15);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(600);
    await expect(sheet).toBeVisible();

    // The card follows the finger.
    await drag(page, box.x + box.width / 2, box.y + 120, 400, false);
    expect(await sheet.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeGreaterThan(300);
    await page.mouse.up();
    await expect(sheet).toBeHidden();
  });
});

test.describe("on a wider screen", () => {
  test("the card fades in already in the middle", async ({ page }) => {
    const frames = await watchEntrance(page);
    expect(frames.every((f) => f.y === 0)).toBe(true);
    expect(Math.min(...frames.map((f) => f.opacity))).toBeLessThan(0.5);
    expect(frames.at(-1)!.opacity).toBe(1);
  });

  test("only the handle drags, and Cancel lets the card fade out before it goes", async ({ page }) => {
    const sheet = await openSheet(page);
    const box = (await sheet.boundingBox())!;

    // Dragging the form leaves the card where it is.
    await drag(page, box.x + box.width / 2, box.y + 150, 300);
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();

    // Cancel: the card is still there, leaving, for a moment.
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveAttribute("data-state", "closed");
    await expect(sheet).toBeHidden();

    // The handle drags it away.
    const again = await openSheet(page);
    const handle = (await page.locator("[data-vaul-handle]").boundingBox())!;
    await drag(page, handle.x + handle.width / 2, handle.y + handle.height / 2, 450);
    await expect(again).toBeHidden();
  });
});
