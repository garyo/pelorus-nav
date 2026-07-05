// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackMeta, TrackPoint } from "../data/Track";
import type { TrackLayer } from "../map/TrackLayer";
import type { TrackRecorder } from "../map/TrackRecorder";
import { getPanelStack } from "./PanelStack";

const { fakeMetas, fakePoints } = vi.hoisted(() => ({
  fakeMetas: [] as TrackMeta[],
  fakePoints: new Map<string, TrackPoint[]>(),
}));

vi.mock("../data/db", () => ({
  getAllTrackMetas: vi.fn(async () => fakeMetas),
  getTrackPoints: vi.fn(async (id: string) => fakePoints.get(id) ?? []),
  saveTrackMeta: vi.fn().mockResolvedValue(undefined),
  deleteTrack: vi.fn().mockResolvedValue(undefined),
  appendTrackPoints: vi.fn().mockResolvedValue(undefined),
}));

import { deleteTrack, getTrackPoints } from "../data/db";
import { TrackManagerPanel } from "./TrackManagerPanel";

function makeMeta(overrides: Partial<TrackMeta> & { id: string }): TrackMeta {
  return {
    name: "Track",
    createdAt: Date.now(),
    color: "#ff4444",
    visible: true,
    pointCount: 5,
    ...overrides,
  };
}

function makeFakeRecorder(): TrackRecorder {
  return {
    isRecording: () => false,
    getCurrentTrack: () => null,
    onRecordingChange: () => {},
  } as unknown as TrackRecorder;
}

function makeFakeTrackLayer(): TrackLayer {
  return {} as unknown as TrackLayer;
}

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function rowFor(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-track-id="${id}"]`);
}

describe("TrackManagerPanel rename latch", () => {
  beforeEach(() => {
    // Clear accumulated rows between tests, but keep the panel-stack
    // container itself attached to document.body (module singleton).
    getPanelStack().innerHTML = "";
    fakeMetas.length = 0;
    fakePoints.clear();
    vi.mocked(deleteTrack).mockClear();
  });

  it("does not remove a row mid-rename via background trivial cleanup", async () => {
    // A legacy track with no cached aggregates: refresh() will kick off a
    // background fillAggregates() that discovers it's trivial (near-zero
    // duration/distance) and normally deletes it.
    const meta = makeMeta({ id: "trivial-1", pointCount: 5 });
    fakeMetas.push(meta);

    // Gate fillAggregates' getTrackPoints read so we can deterministically
    // start the rename *before* the background cleanup resolves, instead
    // of racing microtask counts.
    let resolvePoints: (points: TrackPoint[]) => void = () => {};
    const pointsPromise = new Promise<TrackPoint[]>((resolve) => {
      resolvePoints = resolve;
    });
    vi.mocked(getTrackPoints).mockReturnValueOnce(pointsPromise);

    const panel = new TrackManagerPanel(
      makeFakeTrackLayer(),
      makeFakeRecorder(),
    );
    panel.show();
    await flush();

    const row = rowFor("trivial-1");
    expect(row).not.toBeNull();
    const nameEl = row?.querySelector<HTMLElement>(".manager-item-name");
    expect(nameEl).not.toBeNull();

    // Start a rename before the background trivial-cleanup resolves.
    nameEl?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = row?.querySelector("input");
    expect(input).not.toBeNull();

    // Now let the background fillAggregates -> deleteTrivial chain run —
    // the fetched points are all identical/near-instant, so the computed
    // aggregates are trivial (near-zero duration and distance).
    resolvePoints([
      { lat: 42.0, lon: -71.0, timestamp: 1000, sog: null, cog: null },
      { lat: 42.0, lon: -71.0, timestamp: 1001, sog: null, cog: null },
      { lat: 42.0, lon: -71.0, timestamp: 1002, sog: null, cog: null },
    ]);
    await flush();

    // The row (and the in-progress rename input inside it) must survive —
    // trivial cleanup must not yank it out from under the user.
    expect(rowFor("trivial-1")).not.toBeNull();
    expect(deleteTrack).not.toHaveBeenCalled();
  });
});

describe("TrackManagerPanel hide/show reset the rename latch", () => {
  beforeEach(() => {
    getPanelStack().innerHTML = "";
    fakeMetas.length = 0;
    fakePoints.clear();
  });

  it("un-freezes refresh() after a stuck rename is cleared by hide()/show()", async () => {
    const metaA = makeMeta({
      id: "track-a",
      pointCount: 10,
      durationMs: 60_000,
      totalDistanceNM: 1,
    });
    fakeMetas.push(metaA);

    const panel = new TrackManagerPanel(
      makeFakeTrackLayer(),
      makeFakeRecorder(),
    );
    panel.show();
    await flush();

    const nameEl =
      rowFor("track-a")?.querySelector<HTMLElement>(".manager-item-name");
    nameEl?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(rowFor("track-a")?.querySelector("input")).not.toBeNull();

    // Simulate some other future code path removing the row while the
    // rename input is focused, without ever firing `blur` — the same
    // effect as the trivial-cleanup race, reproduced generically.
    rowFor("track-a")?.remove();

    // A new track shows up (e.g. import, or another tab) while the panel
    // is still frozen from the stuck rename above.
    const metaB = makeMeta({
      id: "track-b",
      pointCount: 10,
      durationMs: 60_000,
      totalDistanceNM: 1,
    });
    fakeMetas.push(metaB);

    // Closing and reopening the panel must clear the stuck latch so the
    // next refresh() actually runs instead of permanently no-op'ing.
    panel.hide();
    panel.show();
    await flush();
    expect(rowFor("track-b")).not.toBeNull();
  });
});
