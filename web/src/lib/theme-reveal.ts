import { applyTheme, type ThemeId } from "./theme";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

// revealTheme switches the theme with a moment of motion: the new theme
// spreads out in a circle from `origin` (the palette button, or the option
// picked) over the old one, by the View Transitions API. Where the API is
// missing, the colours crossfade instead (.theme-fading in app.css). With
// reduced motion, or no origin on screen, it switches at once. The theme
// itself is still applied and saved by applyTheme.
export function revealTheme(id: ThemeId, origin?: Element | null) {
  const root = document.documentElement;
  if (root.dataset.theme === id) return applyTheme(id);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return applyTheme(id);

  const doc = document as ViewTransitionDocument;
  const box = origin?.getBoundingClientRect();
  if (!doc.startViewTransition || !box || box.width === 0) {
    root.classList.add("theme-fading");
    applyTheme(id);
    window.setTimeout(() => root.classList.remove("theme-fading"), 350);
    return;
  }

  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  // Far enough to cover the corner of the screen furthest from the origin.
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = doc.startViewTransition(() => applyTheme(id));
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {
      /* a skipped transition still applied the theme */
    });
}
