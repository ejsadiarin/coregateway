// The phone's movable nav orb: where it rests, when it docks as the bottom
// bar, and where the pages sit on the arc it opens into.

export const ORB_SIZE = 56;
export const ORB_MARGIN = 14;
// Keep the orb clear of the sticky header, and resting just above the
// strip where it would dock.
export const ORB_TOP_GUARD = 72;
export const ORB_BOTTOM_GUARD = 48;
// An orb released with its centre this close to the bottom docks as the bar.
export const DOCK_ZONE = 72;

export type Side = "left" | "right";
export type OrbRest = { side: Side; y: number };

// restSpot is where a thrown orb comes to rest: against the nearer side
// edge once its throw is carried on a little, at a height kept on screen.
// cx/cy is the orb's centre and vx/vy its velocity (px/s) on release; y is
// the orb's top edge.
export function restSpot(cx: number, cy: number, vx: number, vy: number, width: number, height: number): OrbRest {
  const side: Side = cx + vx * 0.18 < width / 2 ? "left" : "right";
  const y = clampOrbTop(cy - ORB_SIZE / 2 + vy * 0.12, height);
  return { side, y };
}

export function clampOrbTop(y: number, height: number): number {
  return Math.min(height - ORB_SIZE - ORB_BOTTOM_GUARD, Math.max(ORB_TOP_GUARD, y));
}

// orbLeft is the orb's left edge when it rests against `side`.
export function orbLeft(side: Side, width: number): number {
  return side === "right" ? width - ORB_SIZE - ORB_MARGIN : ORB_MARGIN;
}

// inDockZone says whether an orb centred at cy would dock as the bar.
export function inDockZone(cy: number, height: number): boolean {
  return cy > height - DOCK_ZONE;
}

// The arc the orb opens into: pages sit `radius` from its centre, STEP
// degrees apart, fading out past SPAN degrees from straight out.
export const ORBIT_RADIUS = 138;
export const ORBIT_STEP = 24;
export const ORBIT_SPAN = 100;

// orbitAngle is the angle (degrees, screen axes: 0 points right, 90 down)
// of a page `rel` places after the focused one. The arc opens away from
// the orb's edge and later pages sit lower.
export function orbitAngle(rel: number, side: Side): number {
  return side === "right" ? 180 - rel * ORBIT_STEP : rel * ORBIT_STEP;
}

// orbitCentreY is the height the orb glides to as it opens, so the whole
// arc fits on screen.
export function orbitCentreY(cy: number, height: number): number {
  return Math.min(height - ORBIT_RADIUS - 80, Math.max(ORBIT_RADIUS + 90, cy));
}
