/**
 * Chart mode state machine: follow, course-up, north-up, free.
 * Manages automatic map centering/rotation based on vessel position.
 */

import type maplibregl from "maplibre-gl";
import type { SmoothedCourse } from "../navigation/CourseSmoothing";
import type { NavigationData } from "../navigation/NavigationData";
import type { ChartMode as ChartModeType } from "../settings";
import { getSettings, updateSettings } from "../settings";

/** Below this speed (knots) the boat sits centered. */
const LOOK_AHEAD_MIN_SPEED_KT = 1;
/** At/above this speed the look-ahead offset reaches its maximum. */
const LOOK_AHEAD_MAX_SPEED_KT = 3;
/**
 * Max boat displacement from canvas center, as a fraction of the
 * canvas dimension along the offset axis. 0.25 puts the boat at ~75%
 * of the way from center to the edge (with ~75% of canvas ahead).
 */
const LOOK_AHEAD_FRACTION = 0.25;

export interface PaddingOptions {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO_PADDING: PaddingOptions = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Compute MapLibre padding that shifts the vessel toward the screen edge
 * opposite its direction of travel, so the area ahead is more visible.
 *
 * @param aheadAngleDeg  Screen angle of "ahead": 0 = up, 90 = right
 *                       (clockwise, MapLibre bearing convention).
 *                       Null means direction unknown — no offset.
 * @param sogKnots       Speed over ground in knots. Null/<min → no offset.
 * @param canvas         CSS pixel dimensions of the visible map canvas.
 */
export function computeLookAheadPadding(
  aheadAngleDeg: number | null,
  sogKnots: number | null,
  canvas: { width: number; height: number },
): PaddingOptions {
  if (
    aheadAngleDeg == null ||
    sogKnots == null ||
    !(canvas.width > 0) ||
    !(canvas.height > 0)
  ) {
    return ZERO_PADDING;
  }
  const speedFrac = Math.max(
    0,
    Math.min(
      1,
      (sogKnots - LOOK_AHEAD_MIN_SPEED_KT) /
        (LOOK_AHEAD_MAX_SPEED_KT - LOOK_AHEAD_MIN_SPEED_KT),
    ),
  );
  if (speedFrac === 0) return ZERO_PADDING;

  // Desired pixel displacement of the boat from the canvas centre.
  // MapLibre places the camera at the centre of the unpadded rectangle,
  // so a padding value of N only shifts the centre by N/2 — hence the
  // `2 ×` multiplier below.
  const theta = (aheadAngleDeg * Math.PI) / 180;
  const offsetY =
    LOOK_AHEAD_FRACTION * canvas.height * speedFrac * Math.cos(theta);
  const offsetX =
    -LOOK_AHEAD_FRACTION * canvas.width * speedFrac * Math.sin(theta);
  return {
    top: Math.max(0, 2 * offsetY),
    bottom: Math.max(0, -2 * offsetY),
    left: Math.max(0, 2 * offsetX),
    right: Math.max(0, -2 * offsetX),
  };
}

export type ChartModeListener = (mode: ChartModeType) => void;

type JumpToArgs = {
  center: [number, number];
  bearing?: number;
  padding: PaddingOptions;
};

export class ChartModeController {
  private readonly map: maplibregl.Map;
  private mode: ChartModeType;
  /** The last non-free mode, so recenter can restore it. */
  private modeBeforeFree: ChartModeType = "north-up";
  private lastData: NavigationData | null = null;
  private lastSmoothed: SmoothedCourse | null = null;
  /** True while mouse/touch is down — suppresses jumpTo so drag can start. */
  private userInteracting = false;
  private readonly listeners: ChartModeListener[] = [];
  /**
   * The args from the most recent `map.jumpTo` we issued. Lets per-frame
   * applyPosition() skip the call when the smoother has converged and
   * nothing has changed. Cleared whenever the map state may have diverged
   * from us — currently just on mode transitions.
   */
  private lastApplied: JumpToArgs | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.mode = getSettings().chartMode;
    if (this.mode !== "free") {
      this.modeBeforeFree = this.mode;
    }

    // Detect user-initiated pan/zoom → switch to free mode
    this.map.on("movestart", (e) => {
      if (
        this.mode !== "free" &&
        (e as maplibregl.MapMouseEvent).originalEvent
      ) {
        this.modeBeforeFree = this.mode;
        this.setMode("free");
      }
    });

    // Suppress jumpTo while user is interacting so drag gestures
    // aren't cancelled by GPS-tick map updates.
    // Press is captured on the canvas; release listens on window so that
    // touchcancel (Android system gestures), pointercancel, mouseup-outside
    // the canvas, and focus loss can never leave the flag stuck true.
    const canvas = this.map.getCanvas();
    const setInteracting = () => {
      this.userInteracting = true;
    };
    const clearInteracting = () => {
      this.userInteracting = false;
    };
    canvas.addEventListener("pointerdown", setInteracting);
    if (typeof window !== "undefined") {
      window.addEventListener("pointerup", clearInteracting);
      window.addEventListener("pointercancel", clearInteracting);
      window.addEventListener("touchend", clearInteracting);
      window.addEventListener("touchcancel", clearInteracting);
      window.addEventListener("blur", clearInteracting);
    }
  }

  getMode(): ChartModeType {
    return this.mode;
  }

  /** Restore the previous non-free mode (used by recenter button). */
  recenter(): void {
    this.setMode(this.modeBeforeFree);
  }

  setMode(mode: ChartModeType): void {
    const changed = this.mode !== mode;
    this.mode = mode;
    if (mode !== "free") {
      this.modeBeforeFree = mode;
    }
    updateSettings({ chartMode: mode });

    // Any mode transition (or even re-asserting the same mode) means the
    // map state may have diverged from our cache — most commonly the user
    // panned the map (→ free) and is now coming back.
    this.lastApplied = null;

    // When switching to north-up, reset bearing
    if (mode === "north-up" && this.map.getBearing() !== 0) {
      this.map.jumpTo({ bearing: 0 });
    }

    // Apply current position if available
    if (this.lastData && mode !== "free") {
      this.applyPosition(this.lastData);
    }

    if (changed) {
      for (const fn of this.listeners) fn(mode);
    }
  }

  /** Subscribe to mode changes; returns an unsubscribe function. */
  onModeChange(listener: ChartModeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  update(data: NavigationData, smoothed?: SmoothedCourse | null): void {
    this.lastData = data;
    if (smoothed !== undefined) {
      this.lastSmoothed = smoothed;
    }
    if (this.mode !== "free" && !this.userInteracting) {
      this.applyPosition(data);
    }
  }

  private applyPosition(data: NavigationData): void {
    const s = this.lastSmoothed;
    const center: [number, number] = s
      ? [s.lon, s.lat]
      : [data.longitude, data.latitude];

    const sog = s?.sog ?? data.sog;
    const cog = s?.cog ?? data.heading ?? data.cog;
    // The look-ahead offset is computed relative to the VISIBLE map area
    // (the container) — MapLibre's canvas can be CSS-sized larger than its
    // container, so we add the overshoot to padding.bottom/right.
    const container = this.map.getContainer();
    const canvas = this.map.getCanvas();
    const visible = {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    const overshoot = {
      bottom: Math.max(0, canvas.clientHeight - visible.height),
      right: Math.max(0, canvas.clientWidth - visible.width),
    };

    let args: JumpToArgs;
    switch (this.mode) {
      case "follow": {
        // Bearing is whatever the user last set; ahead-on-screen = cog - bearing.
        const theta = cog != null ? cog - this.map.getBearing() : null;
        const padding = addOvershoot(
          computeLookAheadPadding(theta, sog, visible),
          overshoot,
        );
        args = { center, padding };
        break;
      }
      case "course-up": {
        const bearing = cog ?? 0;
        // Map is rotated so cog → screen-up; ahead is always up.
        const theta = cog != null ? 0 : null;
        const padding = addOvershoot(
          computeLookAheadPadding(theta, sog, visible),
          overshoot,
        );
        args = { center, bearing, padding };
        break;
      }
      case "north-up": {
        // Bearing 0, so screen angle of ahead == cog itself.
        const padding = addOvershoot(
          computeLookAheadPadding(cog ?? null, sog, visible),
          overshoot,
        );
        args = { center, bearing: 0, padding };
        break;
      }
      default:
        // mode === "free" — applyPosition's callers already guard this, but
        // keep the switch exhaustive so the args assignment is provably
        // complete to the type-checker.
        return;
    }

    // After the CourseSmoothing converges, args becomes bit-identical
    // between frames — skip the jumpTo to save the per-frame work.
    if (sameJumpToArgs(this.lastApplied, args)) return;
    this.lastApplied = args;
    this.map.jumpTo(args);
  }
}

function sameJumpToArgs(a: JumpToArgs | null, b: JumpToArgs): boolean {
  if (!a) return false;
  if (a.center[0] !== b.center[0] || a.center[1] !== b.center[1]) return false;
  if (a.bearing !== b.bearing) return false; // both undefined → equal
  return (
    a.padding.top === b.padding.top &&
    a.padding.bottom === b.padding.bottom &&
    a.padding.left === b.padding.left &&
    a.padding.right === b.padding.right
  );
}

function addOvershoot(
  pad: PaddingOptions,
  overshoot: { bottom: number; right: number },
): PaddingOptions {
  return {
    top: pad.top,
    bottom: pad.bottom + overshoot.bottom,
    left: pad.left,
    right: pad.right + overshoot.right,
  };
}
