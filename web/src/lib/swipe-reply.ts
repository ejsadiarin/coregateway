// Swipe to reply (coregateway#78): on a touch screen a note dragged left
// past a mark starts a reply, like a chat app. These are the gesture's
// decisions; the Feed's SwipeToReply moves the bubble.

export const SWIPE = {
  // How far the finger moves before the drag is read as one way or other.
  slop: 10,
  // How far the bubble has moved when letting go starts a reply.
  mark: 64,
  // The furthest the bubble moves.
  max: 96,
  // How much of the finger's travel the bubble follows.
  follow: 0.6,
};

// swipeIntent reads a drag of dx, dy from where the finger went down:
// "swipe" once it is clearly leftward, "ignore" once it is anything else
// (a scroll, a diagonal, a rightward drag), and null while it is too small
// to tell.
export function swipeIntent(dx: number, dy: number): "swipe" | "ignore" | null {
  if (Math.abs(dx) < SWIPE.slop && Math.abs(dy) < SWIPE.slop) return null;
  return dx < 0 && Math.abs(dx) > 1.5 * Math.abs(dy) ? "swipe" : "ignore";
}

// swipeOffset is where the bubble sits for a finger dx from where it went
// down: never right, lagging the finger, and no further than SWIPE.max.
export const swipeOffset = (dx: number): number => (dx >= 0 ? 0 : Math.max(dx * SWIPE.follow, -SWIPE.max));
