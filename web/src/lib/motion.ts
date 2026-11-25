// Shared motion rules (DESIGN §6).

const STAGGER_STEP = 0.06;
const STAGGER_CAP = 5;

// staggerDelay is the entrance delay, in seconds, of the i-th item of a
// list: a short cascade over the first five, then the rest arrive together.
export function staggerDelay(i: number): number {
  return Math.round(Math.min(i, STAGGER_CAP - 1) * STAGGER_STEP * 100) / 100;
}

// tabEnterFrom is the side a page reached by moving between bottom-nav
// tabs slides in from: the side of the tab picked, relative to the one
// left. `from` and `to` are the tabs (paths in `tabs`, in nav order) the
// pages belong to, or null for a page under no tab; null back means the
// move was not between two tabs.
export function tabEnterFrom(tabs: readonly string[], from: string | null, to: string | null): "left" | "right" | null {
  if (from === null || to === null) return null;
  const a = tabs.indexOf(from);
  const b = tabs.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  return b > a ? "right" : "left";
}
