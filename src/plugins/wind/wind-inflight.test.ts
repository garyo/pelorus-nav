import { describe, expect, it } from "vitest";
import { InFlightTracker } from "./wind-inflight";

describe("InFlightTracker", () => {
  it("excludes keys already in flight so an overlapping refresh doesn't re-fetch them", () => {
    const tracker = new InFlightTracker();
    const points = [{ key: "a" }, { key: "b" }];

    // First refresh starts fetching both points.
    const toFetch1 = tracker.filterNew(points);
    expect(toFetch1).toEqual(points);
    tracker.begin(toFetch1);

    // A second, overlapping refresh arrives before the first settles: nothing
    // new to fetch, since both keys are already in flight.
    const toFetch2 = tracker.filterNew(points);
    expect(toFetch2).toEqual([]);

    // The first fetch settles; the keys become fetchable again.
    tracker.end(toFetch1);
    const toFetch3 = tracker.filterNew(points);
    expect(toFetch3).toEqual(points);
  });

  it("clears in-flight status on failure too, so the next refresh retries", () => {
    const tracker = new InFlightTracker();
    const points = [{ key: "a" }];
    tracker.begin(points);
    expect(tracker.has("a")).toBe(true);
    // Simulate a failed fetch: caller still calls end() in a finally block.
    tracker.end(points);
    expect(tracker.has("a")).toBe(false);
    expect(tracker.filterNew(points)).toEqual(points);
  });

  it("only excludes points whose key is in flight, not all points", () => {
    const tracker = new InFlightTracker();
    tracker.begin([{ key: "a" }]);
    const result = tracker.filterNew([{ key: "a" }, { key: "b" }]);
    expect(result).toEqual([{ key: "b" }]);
  });
});
