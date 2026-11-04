import { describe, expect, it } from "vitest";
import { GPSFilter } from "./GPSFilter";
import type { NavigationData } from "./NavigationData";
import { ReceiverVelocityCheck } from "./receiver-velocity";

const LAT = 42.44;
const LON = -71.12;
const M_PER_DEG = 111_111;

/**
 * Fixes 1 s apart travelling east at `trueKn` (optionally after `startS`
 * seconds), reporting `reportedKn` on `reportedCog`.
 */
function walk(
  seconds: number,
  trueKn: number,
  reportedKn: number,
  reportedCog = 90,
  startS = 0,
): NavigationData[] {
  const cosLat = Math.cos((LAT * Math.PI) / 180);
  return Array.from({ length: seconds }, (_, i) => {
    const t = startS + i;
    const eastM = t * trueKn * (1852 / 3600);
    return {
      latitude: LAT,
      longitude: LON + eastM / (M_PER_DEG * cosLat),
      sog: reportedKn,
      cog: reportedCog,
      heading: null,
      accuracy: 3,
      timestamp: 1_800_000_000_000 + t * 1000,
      source: "test",
    };
  });
}

function feed(check: ReceiverVelocityCheck, fixes: NavigationData[]) {
  return fixes.map((f) => check.add(f)).filter((v) => v !== null);
}

describe("ReceiverVelocityCheck", () => {
  it("trusts a receiver whose velocity matches its positions", () => {
    const check = new ReceiverVelocityCheck();
    const verdicts = feed(check, walk(600, 2.5, 2.5));
    expect(verdicts.length).toBeGreaterThan(5);
    expect(verdicts.every((v) => v.agrees)).toBe(true);
    expect(check.trusted).toBe(true);
  });

  it("distrusts a receiver reporting 40% of its speed after three stretches", () => {
    const check = new ReceiverVelocityCheck();
    const verdicts = feed(check, walk(600, 2.5, 1.0));
    expect(verdicts[0].ratio).toBeCloseTo(0.4, 1);
    expect(check.trusted).toBe(false);
    // A 50 m stretch at 2.5 kn takes ~39 s: distrusted after ~2 minutes.
    const check2 = new ReceiverVelocityCheck();
    feed(check2, walk(110, 2.5, 1.0));
    expect(check2.trusted).toBe(true);
    feed(check2, walk(20, 2.5, 1.0, 90, 110));
    expect(check2.trusted).toBe(false);
  });

  it("distrusts a course 40° off", () => {
    const check = new ReceiverVelocityCheck();
    const [v] = feed(check, walk(600, 2.5, 2.5, 130));
    expect(v.angleDeg).toBeCloseTo(40, 0);
    expect(check.trusted).toBe(false);
  });

  it("trusts the receiver again after three agreeing stretches", () => {
    const check = new ReceiverVelocityCheck();
    feed(check, walk(300, 2.5, 1.0));
    expect(check.trusted).toBe(false);
    feed(check, walk(300, 2.5, 2.5, 90, 300));
    expect(check.trusted).toBe(true);
  });

  it("judges nothing while too slow to cover a stretch", () => {
    const check = new ReceiverVelocityCheck();
    expect(feed(check, walk(600, 0.1, 1.0))).toEqual([]);
    expect(check.trusted).toBe(true);
  });

  it("judges nothing without a reported velocity", () => {
    const check = new ReceiverVelocityCheck();
    const fixes = walk(600, 2.5, 1.0).map((f) => ({ ...f, sog: null }));
    expect(feed(check, fixes)).toEqual([]);
  });
});

describe("GPSFilter with an untrusted receiver", () => {
  it("shows the position-derived speed and course instead", () => {
    const filter = new GPSFilter();
    let out: NavigationData | null = null;
    for (const f of walk(600, 2.5, 1.0, 130)) out = filter.filter(f);
    expect(filter.receiverVelocityCheck.trusted).toBe(false);
    expect(out?.sog).toBeCloseTo(2.5, 1);
    expect(out?.cog).toBeCloseTo(90, 0);
  });

  it("shows a trusted receiver's speed and course as sent", () => {
    const filter = new GPSFilter();
    let out: NavigationData | null = null;
    for (const f of walk(600, 2.5, 2.6, 92)) out = filter.filter(f);
    expect(out?.sog).toBe(2.6);
    expect(out?.cog).toBe(92);
  });
});
