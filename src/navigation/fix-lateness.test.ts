import { describe, expect, it } from "vitest";
import { createFixLateness } from "./fix-lateness";

const T = 1_800_000_000_000;

describe("createFixLateness", () => {
  it("trusts the device clock until it has seen steady fixes", () => {
    const lateness = createFixLateness();
    expect(lateness.of(T, T + 4000)).toBe(4000);
  });

  it("allows for a device clock running ahead of GPS time", () => {
    const lateness = createFixLateness();
    // Live fixes arrive ~200 ms after their GPS time, by a clock 30 s fast.
    for (let i = 0; i < 10; i++) {
      lateness.note(T + i * 1000, T + i * 1000 + 30_200, true);
    }
    expect(lateness.of(T + 20_000, T + 20_000 + 30_200)).toBe(0);
    // A backlog fix two minutes old is still late.
    expect(lateness.of(T, T + 120_000 + 30_200)).toBe(120_000);
  });

  it("allows for a device clock running behind", () => {
    const lateness = createFixLateness();
    lateness.note(T, T - 15_000 + 300, true);
    expect(lateness.of(T + 5000, T + 5000 - 15_000 + 300)).toBe(0);
  });

  it("follows a corrected device clock within minutes", () => {
    const lateness = createFixLateness();
    lateness.note(T, T - 20_000, true); // clock 20 s slow
    // NTP sets it right; six minutes on, the slow samples have expired.
    const later = T + 360_000;
    lateness.note(later, later + 200, true);
    expect(lateness.of(later, later + 200)).toBe(0);
  });

  it("learns nothing from fixes that may be a backlog", () => {
    const lateness = createFixLateness();
    lateness.note(T, T + 600_000, false); // delivered on waking
    expect(lateness.of(T, T + 600_000)).toBe(600_000);
  });
});
