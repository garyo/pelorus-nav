import { describe, expect, it } from "vitest";
import { sunTimes } from "./sun";

const MIN = 60_000;

describe("sunTimes", () => {
  it("matches known London summer-solstice times (UTC)", () => {
    // London 2025-06-21: sunrise 04:43 BST (03:43Z), sunset 21:21 BST (20:21Z).
    const t = sunTimes(new Date("2025-06-21T12:00:00Z"), 51.5074, -0.1278);
    expect(
      Math.abs((t.sunrise as Date).getTime() - Date.UTC(2025, 5, 21, 3, 43)),
    ).toBeLessThan(4 * MIN);
    expect(
      Math.abs((t.sunset as Date).getTime() - Date.UTC(2025, 5, 21, 20, 21)),
    ).toBeLessThan(4 * MIN);
  });

  it("matches known New York winter times (UTC)", () => {
    // NYC 2025-12-21: sunrise 07:17 EST (12:17Z), sunset 16:32 EST (21:32Z).
    const t = sunTimes(new Date("2025-12-21T17:00:00Z"), 40.7128, -74.006);
    expect(
      Math.abs((t.sunrise as Date).getTime() - Date.UTC(2025, 11, 21, 12, 17)),
    ).toBeLessThan(4 * MIN);
    expect(
      Math.abs((t.sunset as Date).getTime() - Date.UTC(2025, 11, 21, 21, 32)),
    ).toBeLessThan(4 * MIN);
  });

  it("orders civil twilight around sunrise/noon/sunset", () => {
    const t = sunTimes(new Date("2025-06-21T16:00:00Z"), 42.36, -71.06); // Boston
    const ms = (d: Date | null) => (d as Date).getTime();
    expect(ms(t.civilDawn)).toBeLessThan(ms(t.sunrise));
    expect(ms(t.sunrise)).toBeLessThan(t.transit.getTime());
    expect(t.transit.getTime()).toBeLessThan(ms(t.sunset));
    expect(ms(t.sunset)).toBeLessThan(ms(t.civilDusk));
  });

  it("gives a ~12 h day at the equator on the equinox", () => {
    const t = sunTimes(new Date("2025-03-20T12:00:00Z"), 0, 0);
    const dayLen = (t.sunset as Date).getTime() - (t.sunrise as Date).getTime();
    expect(Math.abs(dayLen - 12 * 3600 * 1000)).toBeLessThan(10 * MIN);
  });

  it("returns null sunrise/sunset during polar day (Svalbard, summer)", () => {
    const t = sunTimes(new Date("2025-06-21T12:00:00Z"), 78.22, 15.65);
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
  });
});
