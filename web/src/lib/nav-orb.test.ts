import { describe, expect, it } from "vitest";
import { ORB_SIZE, ORB_TOP_GUARD, clampOrbTop, inDockZone, orbLeft, orbitAngle, orbitCentreY, restSpot } from "./nav-orb";

const W = 390;
const H = 844;

// Let go of the orb and it settles against the nearer side, its throw
// carried on a little.
describe("restSpot", () => {
  it("rests on the side its centre is nearer", () => {
    expect(restSpot(100, 400, 0, 0, W, H).side).toBe("left");
    expect(restSpot(300, 400, 0, 0, W, H).side).toBe("right");
  });

  it("a throw towards the other side carries it over", () => {
    expect(restSpot(150, 400, 1500, 0, W, H).side).toBe("right");
    expect(restSpot(250, 400, -1500, 0, W, H).side).toBe("left");
  });

  it("stays under the header and above the bottom edge", () => {
    expect(restSpot(300, 0, 0, -3000, W, H).y).toBe(ORB_TOP_GUARD);
    expect(restSpot(300, H, 0, 3000, W, H).y).toBe(clampOrbTop(Infinity, H));
    expect(restSpot(300, 400, 0, 0, W, H).y).toBe(400 - ORB_SIZE / 2);
  });
});

describe("orbLeft", () => {
  it("hugs the chosen edge with the orb fully on screen", () => {
    expect(orbLeft("left", W)).toBeGreaterThan(0);
    expect(orbLeft("right", W) + ORB_SIZE).toBeLessThan(W);
  });
});

// Released at the very bottom, the orb docks as the bar.
describe("inDockZone", () => {
  it("is the strip along the bottom edge", () => {
    expect(inDockZone(H - 10, H)).toBe(true);
    expect(inDockZone(H - 200, H)).toBe(false);
  });

  it("never holds an orb that came to rest, however hard it was thrown down", () => {
    const spot = restSpot(300, H - 80, 0, 5000, W, H);
    expect(inDockZone(spot.y + ORB_SIZE / 2, H)).toBe(false);
  });
});

describe("orbitAngle", () => {
  it("points straight away from the orb's edge for the focused page", () => {
    expect(orbitAngle(0, "right")).toBe(180);
    expect(orbitAngle(0, "left")).toBe(0);
  });

  it("puts later pages lower on either side", () => {
    const down = (deg: number) => Math.sin((deg * Math.PI) / 180);
    expect(down(orbitAngle(1, "right"))).toBeGreaterThan(0);
    expect(down(orbitAngle(1, "left"))).toBeGreaterThan(0);
    expect(down(orbitAngle(-1, "right"))).toBeLessThan(0);
  });
});

describe("orbitCentreY", () => {
  it("glides the orb off the edges so the arc fits, and leaves it be mid-screen", () => {
    expect(orbitCentreY(H - 30, H)).toBeLessThan(H - 30);
    expect(orbitCentreY(10, H)).toBeGreaterThan(10);
    expect(orbitCentreY(H / 2, H)).toBe(H / 2);
  });
});
