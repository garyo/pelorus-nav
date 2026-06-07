/**
 * End-to-end course-pipeline lag regression test.
 *
 * Replays a real recorded ~109° tack (off Deer Island, 2026-06-04 sail)
 * through the production GPS pipeline — replayPosition → GPSFilter →
 * CourseSmoothing — at 10× sim speed with 2 s fixes and 100 ms frames,
 * and asserts the smoothed COG (which drives the course line) catches up
 * within the field-tuned budget. All time is virtual; runs in ~ms.
 *
 * Tuning context (2026-06): Kalman ≈ 4 s + smoother ≈ 5 s (window and tau
 * scale up with the quality score; q=0.1 here) ⇒ 9.0 s wall to come within
 * 15° of the new heading. If this fails after a constants change,
 * re-measure before loosening the bound.
 */

import { describe, expect, it } from "vitest";
import { CourseSmoothing } from "./CourseSmoothing";
import { GPSFilter } from "./GPSFilter";
import { replayPosition } from "./SimulatorProvider";

// Excerpt of the 2026-06-04 track: the settled southbound approach leg,
// then the tack (161° → ~52°) at t=457. Embedded so the test is
// independent of the swappable replay track. The sparse stretches are
// the adaptive GPS slow tier — real data.
const TACK_SEGMENT: [number, number, number][] = [
  [0, 42.34196, -70.96415],
  [19, 42.34172, -70.96404],
  [34, 42.34158, -70.96399],
  [49, 42.3415, -70.96397],
  [64, 42.34136, -70.96396],
  [79, 42.34115, -70.964],
  [94, 42.3409, -70.96405],
  [109, 42.34057, -70.96407],
  [267, 42.33835, -70.9638],
  [283, 42.33814, -70.96377],
  [298, 42.33792, -70.96371],
  [457, 42.33549, -70.96258],
  [474, 42.33567, -70.96227],
  [488, 42.33582, -70.96197],
  [515, 42.33618, -70.96139],
  [530, 42.33638, -70.96107],
  [544, 42.33653, -70.96073],
  [562, 42.33669, -70.96029],
  [593, 42.33708, -70.95953],
  [621, 42.33741, -70.95901],
];

const TURN_BOAT_T = 457; // seconds into the segment
const MULT = 10; // sim speed multiplier
const FIX_MS = 2000; // non-eink forced GPS rate
const FRAME_MS = 100; // steady-state repaint throttle

const angdiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

describe("course pipeline lag through a real tack at 10x", () => {
  it("smoothed COG reaches the new heading within the tuned budget", () => {
    const filter = new GPSFilter();
    const smoother = new CourseSmoothing();
    smoother.setQuality(0.1); // measured simulator quality score

    // Heading of the post-tack leg, derived from the data itself
    const newHeading = replayPosition(TACK_SEGMENT, TURN_BOAT_T + 60).cog;
    expect(Math.abs(angdiff(newHeading, 52))).toBeLessThan(10);

    const turnWallS = TURN_BOAT_T / MULT;
    let convergedAfterS: number | null = null;

    for (let wallMs = 0; wallMs <= 60_000; wallMs += FRAME_MS) {
      const wallS = wallMs / 1000;
      const boatT = wallS * MULT;
      if (boatT >= TACK_SEGMENT[TACK_SEGMENT.length - 1][0]) break;

      if (wallMs % FIX_MS === 0) {
        const p = replayPosition(TACK_SEGMENT, boatT);
        const out = filter.filter(
          {
            latitude: p.lat,
            longitude: p.lon,
            sog: p.sogKn * MULT,
            cog: p.cog,
            heading: p.cog,
            accuracy: 6,
            timestamp: wallMs,
            source: "simulator",
          },
          0.1,
        );
        smoother.addSample(
          out.cog,
          out.sog,
          out.latitude,
          out.longitude,
          wallMs,
        );
      }

      const sm = smoother.smooth(wallMs);
      if (
        wallS > turnWallS &&
        sm &&
        Math.abs(angdiff(sm.cog, newHeading)) < 15
      ) {
        convergedAfterS = wallS - turnWallS;
        break;
      }
    }

    expect(convergedAfterS, "smoothed COG never converged").not.toBeNull();
    // Pinned at the 2026-06 tuning: measures 9.0 s (Kalman ~4 s + smoother
    // ~5 s at q=0.1, which scales the window/tau up from their q=0 values).
    expect(convergedAfterS ?? Infinity).toBeLessThan(10);
    // Sanity: it shouldn't converge before the boat has actually turned
    expect(convergedAfterS ?? 0).toBeGreaterThan(2);
  });
});
