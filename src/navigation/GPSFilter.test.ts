import { describe, expect, it } from "vitest";
import { GPSFilter } from "./GPSFilter";
import type { NavigationData } from "./NavigationData";

function makeFix(
  overrides: Partial<NavigationData> & { timestamp: number },
): NavigationData {
  return {
    latitude: 42.35,
    longitude: -71.04,
    cog: 90,
    sog: 6,
    heading: 90,
    accuracy: 5,
    source: "test",
    ...overrides,
  };
}

describe("GPSFilter", () => {
  it("returns first fix unchanged", () => {
    const filter = new GPSFilter();
    const fix = makeFix({ timestamp: 1000 });
    const out = filter.filter(fix);
    expect(out.latitude).toBe(fix.latitude);
    expect(out.longitude).toBe(fix.longitude);
    expect(out.cog).toBe(fix.cog);
    expect(out.sog).toBe(fix.sog);
  });

  it("reduces noise for stationary vessel", () => {
    const filter = new GPSFilter();
    const baseLat = 42.35;
    const baseLon = -71.04;

    // Seed the filter
    filter.filter(
      makeFix({
        latitude: baseLat,
        longitude: baseLon,
        sog: 0,
        cog: null,
        timestamp: 0,
      }),
    );

    // Feed noisy stationary fixes
    const noisyPositions: Array<[number, number]> = [];
    const filteredPositions: Array<[number, number]> = [];

    for (let i = 1; i <= 30; i++) {
      const noiseLat = (Math.random() - 0.5) * 0.0002; // ~10m noise
      const noiseLon = (Math.random() - 0.5) * 0.0002;
      const lat = baseLat + noiseLat;
      const lon = baseLon + noiseLon;
      noisyPositions.push([lat, lon]);

      const out = filter.filter(
        makeFix({
          latitude: lat,
          longitude: lon,
          sog: 0,
          cog: null,
          timestamp: i * 1000,
        }),
      );
      filteredPositions.push([out.latitude, out.longitude]);
    }

    // Compute RMS error from true position for noisy vs filtered
    const rmsNoisy = rms(
      noisyPositions.map(([lat, lon]) =>
        Math.sqrt((lat - baseLat) ** 2 + (lon - baseLon) ** 2),
      ),
    );
    const rmsFiltered = rms(
      filteredPositions.map(([lat, lon]) =>
        Math.sqrt((lat - baseLat) ** 2 + (lon - baseLon) ** 2),
      ),
    );

    expect(rmsFiltered).toBeLessThan(rmsNoisy);
  });

  it("tracks steady course with convergent SOG", () => {
    const filter = new GPSFilter();
    const startLat = 42.35;
    const startLon = -71.04;
    const sogKn = 6; // 6 knots due east
    // 6 knots = 6 * 1852 / 3600 m/s = 3.087 m/s
    const cosLat = Math.cos((startLat * Math.PI) / 180);
    const degPerSecLon = (sogKn * 1852) / (3600 * 111_111 * cosLat);

    filter.filter(
      makeFix({ latitude: startLat, longitude: startLon, timestamp: 0 }),
    );

    let lastOut: NavigationData | null = null;
    for (let i = 1; i <= 20; i++) {
      const trueLon = startLon + degPerSecLon * i;
      // Add small noise
      const noise = (Math.random() - 0.5) * 0.00005;
      lastOut = filter.filter(
        makeFix({
          latitude: startLat + noise,
          longitude: trueLon + noise,
          sog: sogKn,
          cog: 90,
          timestamp: i * 1000,
        }),
      );
    }

    // SOG should be roughly 6 knots after convergence
    expect(lastOut?.sog).toBeGreaterThan(4);
    expect(lastOut?.sog).toBeLessThan(8);
    // COG should be roughly east
    expect(lastOut?.cog).toBeGreaterThan(60);
    expect(lastOut?.cog).toBeLessThan(120);
  });

  it("resets on large position jump", () => {
    const filter = new GPSFilter();
    filter.filter(
      makeFix({ latitude: 42.35, longitude: -71.04, timestamp: 0 }),
    );
    filter.filter(
      makeFix({ latitude: 42.35, longitude: -71.04, timestamp: 1000 }),
    );

    // Jump 10km away — should reset, return the jumped-to position
    const jumped = filter.filter(
      makeFix({ latitude: 42.45, longitude: -71.04, timestamp: 2000 }),
    );
    expect(jumped.latitude).toBe(42.45);
    expect(jumped.longitude).toBe(-71.04);
  });

  it("resets after stale gap", () => {
    const filter = new GPSFilter();
    filter.filter(
      makeFix({ latitude: 42.35, longitude: -71.04, timestamp: 0 }),
    );
    filter.filter(
      makeFix({ latitude: 42.3501, longitude: -71.04, timestamp: 1000 }),
    );

    // 60s gap — exceeds staleGapMs
    const afterGap = filter.filter(
      makeFix({ latitude: 42.36, longitude: -71.04, timestamp: 61_000 }),
    );
    // Should return the raw fix (reset)
    expect(afterGap.latitude).toBe(42.36);
  });

  it("preserves heading unchanged", () => {
    const filter = new GPSFilter();
    filter.filter(makeFix({ heading: 45, timestamp: 0 }));
    const out = filter.filter(makeFix({ heading: 123, timestamp: 1000 }));
    expect(out.heading).toBe(123);
  });

  it("nulls COG when nearly stationary", () => {
    const filter = new GPSFilter();
    filter.filter(
      makeFix({
        latitude: 42.35,
        longitude: -71.04,
        sog: 0,
        cog: null,
        timestamp: 0,
      }),
    );

    // Several stationary fixes — velocity should converge near zero
    let lastOut: NavigationData | null = null;
    for (let i = 1; i <= 15; i++) {
      lastOut = filter.filter(
        makeFix({
          latitude: 42.35,
          longitude: -71.04,
          sog: 0,
          cog: null,
          timestamp: i * 1000,
        }),
      );
    }

    // COG should be null when nearly stationary
    expect(lastOut?.cog).toBeNull();
    expect(lastOut?.sog).toBeLessThan(0.1);
  });

  it("weights high-accuracy fixes more", () => {
    const filter = new GPSFilter();
    const baseLat = 42.35;

    filter.filter(
      makeFix({ latitude: baseLat, longitude: -71.04, timestamp: 0 }),
    );

    // Low accuracy fix — should be partially ignored
    const lowAcc = filter.filter(
      makeFix({
        latitude: baseLat + 0.001,
        longitude: -71.04,
        accuracy: 50,
        timestamp: 1000,
      }),
    );

    // Reset and try high accuracy
    filter.reset();
    filter.filter(
      makeFix({ latitude: baseLat, longitude: -71.04, timestamp: 0 }),
    );

    const highAcc = filter.filter(
      makeFix({
        latitude: baseLat + 0.001,
        longitude: -71.04,
        accuracy: 3,
        timestamp: 1000,
      }),
    );

    // High-accuracy fix should pull the estimate closer to the measurement
    const lowAccShift = Math.abs(lowAcc.latitude - baseLat);
    const highAccShift = Math.abs(highAcc.latitude - baseLat);
    expect(highAccShift).toBeGreaterThan(lowAccShift);
  });

  it("reset() clears state", () => {
    const filter = new GPSFilter();
    filter.filter(makeFix({ timestamp: 0 }));
    expect(filter.isInitialized()).toBe(true);
    filter.reset();
    expect(filter.isInitialized()).toBe(false);
  });
});

function rms(values: number[]): number {
  const sum = values.reduce((s, v) => s + v * v, 0);
  return Math.sqrt(sum / values.length);
}
