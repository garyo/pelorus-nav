/**
 * Anchor-mode surface: one bottom-center card that shows the setup view
 * (boat/anchorage parameters, computed watch radius, anchor placement,
 * hold-to-arm) while disarmed and the armed view (distance/bearing to the
 * anchor, radius quick-adjust, time at anchor, GPS quality, mute,
 * hold-to-disarm) while a watch is running. The card is visible only in
 * anchor mode; the watch itself keeps running when the user leaves the mode.
 *
 * A separate alarm banner is a `priority` surface (COB precedent) that shows
 * whenever an alarm sounds, in any mode: tapping anywhere on it acknowledges
 * — silences this event, the watch stays armed — and holding its disarm
 * button is the only full stand-down.
 *
 * Setup parameters persist via the remembered-params slot and seed the next
 * anchorage's defaults. Lengths display in the depth-unit family (m, or ft
 * for feet/fathoms — see anchor-setup.ts); values are stored in meters.
 *
 * Both views carry the tide-aware scope line ("Scope 6.0:1 now → 4.2:1 at HW
 * 4:12 PM"): scope math in anchor-scope.ts, high water from the offline tide
 * predictor at the nearest station. The bundle loads lazily and its absence
 * only shortens the line — it never blocks the panel or arming, and a scope
 * the predictor doesn't like is advice in the setup view, not a gate.
 */

import type { CobAlarm } from "../cob/CobAlarm";
import { formatCobElapsed } from "../cob/cob-state";
import { attachHoldGesture } from "../cob/hold-gesture";
import type { AnchorLayerState } from "../map/AnchorLayer";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { getSettings, onSettingsChange } from "../settings";
import {
  DEFAULT_NEAREST_STATION_NM,
  loadTidesIndex,
  nearestTideStation,
  type TidesIndex,
} from "../tides/bundle";
import {
  formatEventTime,
  formatTideHeight,
  formatTimeUntil,
} from "../tides/format";
import { type TideState, tideState } from "../tides/predictor";
import { hideStatusBanner, showStatusBanner } from "../ui/StatusBanner";
import { registerSurface } from "../ui/SurfaceManager";
import { projectPoint } from "../utils/coordinates";
import { defaultBrowserStorage } from "../utils/json-storage-slot";
import { formatBearing } from "../utils/magnetic";
import { formatDistanceNM, NM_TO_METERS } from "../utils/units";
import {
  type AnchorWatchManager,
  type AnchorWatchSnapshot,
  DEFAULT_WARN_M,
  warnRingRadiusM,
} from "./AnchorWatchManager";
import {
  dropToLow,
  formatScopeRatio,
  highestHighWithin,
  lowestLowWithin,
  riseToHigh,
  SCOPE_MARGINAL,
  type ScopeAdvice,
  scopeAdvice,
  scopeAtTide,
  scopeRatio,
  TIDE_LOOKAHEAD_HRS,
  worstAdvice,
} from "./anchor-scope";
import {
  type AnchorLengthUnit,
  accuracyTooVagueToArm,
  anchorLengthUnit,
  defaultRadiusM,
  formatLength,
  fromDisplayLength,
  gpsMarginM,
  radiusStepM,
  toDisplayLength,
} from "./anchor-setup";
import { type AnchorRememberedParams, anchorParamsSlot } from "./anchor-state";
import {
  armedAdvisoryLine,
  getNativeAnchorStatus,
} from "./native-anchor-watch";

/** Arming is deliberate but not an emergency — a short guarded hold. */
const ARM_HOLD_MS = 1000;
/**
 * Standing the watch down gets COB-grade friction, and a little more: at
 * 2 s the five pips land about 400 ms apart, roughly one e-ink refresh
 * each, so the indicator can actually be read while it counts down.
 */
const DISARM_HOLD_MS = 2000;
const MIN_RADIUS_M = 5;
/**
 * Measured e-ink panel refresh, near enough. One pip per refresh period is
 * the most feedback the display can actually deliver: fewer wastes the hold,
 * more asks for refreshes it cannot finish and they smear together.
 */
const EINK_REFRESH_MS = 350;

/** Pips for a hold of this length — one per refresh the panel can manage. */
function holdPips(holdMs: number): number {
  return Math.min(5, Math.max(2, Math.round(holdMs / EINK_REFRESH_MS)));
}
const NO_FIX_BANNER_MS = 8000;
/**
 * How often the armed view re-asks the native service whether it can actually
 * see the boat, and whether the alarm stream can be heard. Both answers change
 * on the timescale of a GPS acquisition or a volume-key press, so the 1 Hz
 * ticker drives it through a cache rather than calling the plugin every second.
 */
const ADVISORY_POLL_MS = 15_000;
/** Tide predictions move slowly — recompute at most this often. */
const TIDE_REFRESH_MS = 5 * 60 * 1000;
/** Cache-key rounding for the anchor position: ~1 km, far inside a station's reach. */
const TIDE_POS_DECIMALS = 2;
const HOUR_MS = 3600 * 1000;

type AnchorPosMode = "vessel" | "offset" | "tap";

/** What the tide predictor can say about the coming high water, or why not. */
type TideOutlook =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "no-position" }
  | { kind: "no-station" }
  | { kind: "no-prediction" }
  | { kind: "no-high" }
  | {
      kind: "high";
      riseM: number;
      time: Date;
      /** Subordinate station: heights are offset estimates, not a curve. */
      approximate: boolean;
      stationName: string;
      /**
       * Fall to the lowest low water in the same window, if there is one.
       * Low water is the radius case: less water under the boat flattens
       * the rode, so the swing circle is widest then.
       */
      dropM: number | null;
    };

/** Short suffix stating why the tide half of the readout is missing. */
const TIDE_OUTLOOK_NOTE: Record<
  Exclude<TideOutlook["kind"], "high">,
  string
> = {
  loading: "loading tide…",
  unavailable: "tide data unavailable",
  "no-position": "no position for tide",
  "no-station": `no tide station within ${DEFAULT_NEAREST_STATION_NM} NM`,
  "no-prediction": "tide prediction unavailable",
  "no-high": `no high water in ${TIDE_LOOKAHEAD_HRS} h`,
};

const POOR_SCOPE_ADVISORY = `Advisory: scope below ${SCOPE_MARGINAL}:1 — more rode recommended.`;
const GROUNDING_ADVISORY =
  "Advisory: the entered depth falls to zero at low water — check the chart before staying.";
const POOR_AT_HW_ADVISORY = `Advisory: scope drops below ${SCOPE_MARGINAL}:1 at high water — more rode recommended.`;

/** The tide/scope line and its advisory, for both views. */
interface ScopeReadout {
  text: string;
  advice: ScopeAdvice | "none";
  /** Tooltip: station, rise, and any caveat behind the one-line summary. */
  detail: string;
  /** Setup-view advice line; null when there is nothing to flag. */
  advisory: string | null;
}

/** Which of the two required inputs the user still owes us. */
function missingScopeInputs(
  rodeM: number | undefined,
  depthM: number | undefined,
  bowHeightM: number | undefined,
): string {
  const missing: string[] = [];
  if (rodeM === undefined || rodeM <= 0) missing.push("rode");
  if (depthM === undefined || depthM + (bowHeightM ?? 0) <= 0) {
    missing.push("depth");
  }
  if (missing.length === 0) return "Scope unavailable for these values";
  return `Enter ${missing.join(" and ")} for scope`;
}

export interface AnchorPanelDeps {
  manager: AnchorWatchManager;
  navManager: Pick<
    NavigationDataManager,
    | "getLastData"
    | "isFixStale"
    | "subscribe"
    | "unsubscribe"
    | "getQualitySignals"
  >;
  /**
   * Both alarm instances, for blocked-audio detection and gesture unlock.
   * Native alarms are never blocked — the service makes the noise, not an
   * AudioContext — so this disclosure is a web-only affair in practice.
   */
  alarms: Array<
    Pick<CobAlarm, "isBlocked" | "onBlockedChange" | "retryUnlock">
  >;
  /** Leave anchor mode (the watch keeps running if armed). */
  onExitMode(): void;
  /** The pre-arm anchor preview changed — re-render the chart layer. */
  onPreviewChange(): void;
}

const GPS_STATE_TEXT: Record<AnchorWatchSnapshot["gpsState"], string> = {
  ok: "GPS OK",
  poor: "GPS accuracy poor",
  stale: "GPS stale — no recent fix",
  lost: "GPS LOST",
  waiting: "Waiting for GPS — watch not yet active",
};

export class AnchorPanel {
  private armBtn: HTMLButtonElement | null = null;
  /** Arm button's hold indicator, reset when the view swaps. */
  private armHold: { fill: HTMLSpanElement; count: HTMLSpanElement } | null =
    null;
  /** Disarm buttons' hold indicators (panel and alarm banner). */
  private disarmHolds: Array<{
    fill: HTMLSpanElement;
    count: HTMLSpanElement;
  }> = [];
  /** A press-and-hold is running; see setHoldActive. */
  private holdActive = false;
  /** Alarm state that arrived mid-hold, applied once the hold ends. */
  private pendingAlarmSnap: AnchorWatchSnapshot | null | undefined = undefined;
  /** A watch-state repaint is owed from mid-hold; replayed at hold end. */
  private pendingWatchSnap = false;
  private armBlockedEl: HTMLDivElement | null = null;
  private readonly el: HTMLDivElement;
  private readonly alarmEl: HTMLDivElement;
  // Map-interaction mode bar: outside taps place the anchor, so they must
  // not dismiss the surface. Escape (SurfaceManager) closes it = exits mode.
  private readonly surface = registerSurface({
    id: "anchor",
    slot: "bottom-center",
    group: "anchor",
    closeOnOutsideClick: false,
    el: () => this.el,
    isOpen: () => this.el.classList.contains("open"),
    close: () => this.deps.onExitMode(),
  });
  // The alarm outranks everything and is dismissed only by its own
  // tap-to-acknowledge / hold-to-disarm, never by Escape or outside taps.
  private readonly alarmSurface = registerSurface({
    id: "anchor-alarm",
    slot: "bottom-center",
    group: "anchor",
    priority: true,
    el: () => this.alarmEl,
    isOpen: () => this.alarmEl.classList.contains("open"),
    close: () => {},
  });

  private readonly deps: AnchorPanelDeps;
  private readonly storage = defaultBrowserStorage();
  private params: AnchorRememberedParams;
  private modeActive = false;
  private posMode: AnchorPosMode = "vessel";
  private tapped: { lat: number; lon: number } | null = null;
  private offsetDistM = 30;
  private offsetBrgDeg = 0;
  /** Manual watch-radius override in meters; null = computed default. */
  private radiusOverrideM: number | null = null;
  private snap: AnchorWatchSnapshot | null = null;
  /** Cached screen-off-cover disclosure; null = covered, or nothing to say. */
  private advisoryText: string | null = null;
  private advisoryCheckedAt = 0;
  private advisoryPending = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private detachHolds: Array<() => void> = [];

  // Tide-aware scope: the bundle loads lazily (only once a depth exists) and
  // never blocks the panel or arming; predictions are cached per position.
  private tideIndex: TidesIndex | null = null;
  private tideLoading = false;
  private tideLoadFailed = false;
  /** Bumped per load attempt so a late resolution can't overwrite a newer one. */
  private tideLoadGen = 0;
  private tideCache: {
    key: string;
    computedAt: number;
    outlook: TideOutlook;
  } | null = null;
  private disposed = false;

  // Setup elements
  private setupEl!: HTMLDivElement;
  private paramInputs!: Record<
    keyof Omit<AnchorRememberedParams, "version">,
    HTMLInputElement
  >;
  private unitEls: HTMLSpanElement[] = [];
  private radiusInput!: HTMLInputElement;
  private radiusHint!: HTMLDivElement;
  private posButtons!: Record<AnchorPosMode, HTMLButtonElement>;
  private offsetWrap!: HTMLSpanElement;
  private offsetDistInput!: HTMLInputElement;
  private offsetBrgInput!: HTMLInputElement;
  private posHint!: HTMLDivElement;
  private scopeAdvisoryEl!: HTMLDivElement;

  // Armed elements
  private armedEl!: HTMLDivElement;
  private elapsedEl!: HTMLSpanElement;
  private distEl!: HTMLDivElement;
  private brgEl!: HTMLSpanElement;
  private radiusValueEl!: HTMLSpanElement;
  private gpsLineEl!: HTMLDivElement;
  private advisoryEl!: HTMLDivElement;
  private countdownEl!: HTMLDivElement;
  /** The scope/tide line, one per view (setup and armed show the same text). */
  private readonly tideEls: HTMLDivElement[] = [];
  private audioEl!: HTMLDivElement;
  private muteBtn!: HTMLButtonElement;

  // Alarm banner elements
  private alarmTitle!: HTMLDivElement;
  private alarmDetail!: HTMLDivElement;

  constructor(deps: AnchorPanelDeps) {
    this.deps = deps;
    this.params = anchorParamsSlot.load(this.storage) ?? { version: 1 };

    this.el = document.createElement("div");
    this.el.className = "anchor-panel";
    this.alarmEl = document.createElement("div");
    this.alarmEl.className = "anchor-alarm";
    this.build();
    this.buildAlarmBanner();
    document.body.append(this.el, this.alarmEl);

    // Any interaction is a user gesture — use it to unlock audio blocked by
    // autoplay policy after a crash-restore (the CobPanel pattern).
    const retryUnlock = () => {
      for (const a of this.deps.alarms) a.retryUnlock();
    };
    this.el.addEventListener("pointerdown", retryUnlock);
    this.alarmEl.addEventListener("pointerdown", retryUnlock);
    for (const a of this.deps.alarms) {
      a.onBlockedChange(() => this.renderAudioBlocked());
    }

    this.deps.manager.subscribe((snap) => this.onWatchChange(snap));
    this.deps.navManager.subscribe(this.onFix);

    // Re-render field values when the display unit family flips.
    let prevUnit = anchorLengthUnit(getSettings().depthUnit);
    onSettingsChange((s) => {
      const unit = anchorLengthUnit(s.depthUnit);
      if (unit === prevUnit) return;
      prevUnit = unit;
      this.renderSetupValues();
      const snap = this.snap;
      if (snap) this.renderArmed(snap);
    });

    this.onWatchChange(this.deps.manager.getState());
  }

  /** Anchor mode entered/left — show or hide the card (watch unaffected). */
  setModeActive(active: boolean): void {
    if (this.modeActive === active) return;
    this.modeActive = active;
    if (active) {
      // Entering the mode is what makes the tide bundle worth fetching.
      if (this.snap) {
        this.renderScope();
        // The card may have been closed for hours; don't open on a stale
        // verdict about whether the watch is covered.
        this.refreshAdvisory(true);
      } else this.renderSetupLive();
      this.el.classList.add("open");
      this.surface.opened();
    } else {
      this.el.classList.remove("open");
    }
    this.updateTicker();
    this.deps.onPreviewChange();
  }

  /** Map tap while in the mode and not armed — place/move the anchor. */
  placeAnchorAt(lat: number, lon: number): void {
    this.tapped = { lat, lon };
    this.setPosMode("tap");
  }

  /**
   * Chart preview of the pending watch (dashed gray circle at the would-be
   * anchor position); null when nothing should show.
   */
  previewLayerState(): AnchorLayerState | null {
    if (!this.modeActive || this.deps.manager.isArmed()) return null;
    const pos = this.resolveAnchorPosition();
    if (!pos) return null;
    const radiusM = this.effectiveRadiusM();
    return {
      anchor: pos,
      radiusM,
      warnM: radiusM - warnRingRadiusM(radiusM, DEFAULT_WARN_M),
      zone: "gray",
      scatter: [],
    };
  }

  // --- Build ---

  private build(): void {
    const header = document.createElement("div");
    header.className = "anchor-panel-header";
    const title = document.createElement("span");
    title.className = "anchor-panel-title";
    title.textContent = "ANCHOR WATCH";
    this.elapsedEl = document.createElement("span");
    this.elapsedEl.className = "anchor-panel-elapsed";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "anchor-panel-close";
    closeBtn.setAttribute("aria-label", "Leave anchor mode");
    closeBtn.title = "Leave anchor mode (an armed watch keeps running)";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.deps.onExitMode());
    header.append(title, this.elapsedEl, closeBtn);

    this.buildSetup();
    this.buildArmed();
    this.el.append(header, this.setupEl, this.armedEl);
  }

  private numberInput(className: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = "any";
    input.className = className;
    return input;
  }

  /** The scope/tide line; both views carry one, rendered from one readout. */
  private buildTideLine(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "anchor-tide";
    this.tideEls.push(el);
    return el;
  }

  private buildSetup(): void {
    this.setupEl = document.createElement("div");
    this.setupEl.className = "anchor-setup";

    // Boat + anchorage parameters, remembered across sessions.
    const fields = document.createElement("div");
    fields.className = "anchor-fields";
    const paramField = (
      label: string,
      key: keyof Omit<AnchorRememberedParams, "version">,
    ): HTMLInputElement => {
      const wrap = document.createElement("label");
      wrap.className = "anchor-field";
      const lab = document.createElement("span");
      lab.className = "anchor-field-label";
      lab.textContent = label;
      const input = this.numberInput("anchor-field-input");
      input.addEventListener("input", () => {
        const v = Number.parseFloat(input.value);
        this.params = {
          ...this.params,
          [key]:
            Number.isFinite(v) && v >= 0
              ? fromDisplayLength(v, this.unit())
              : undefined,
        };
        anchorParamsSlot.save(this.params, this.storage);
        this.renderSetupLive();
      });
      const unitEl = document.createElement("span");
      unitEl.className = "anchor-field-unit";
      this.unitEls.push(unitEl);
      wrap.append(lab, input, unitEl);
      fields.appendChild(wrap);
      return input;
    };
    this.paramInputs = {
      boatLengthM: paramField("Boat length", "boatLengthM"),
      bowHeightM: paramField("Bow height", "bowHeightM"),
      lastRodeM: paramField("Rode out", "lastRodeM"),
      lastDepthM: paramField("Depth", "lastDepthM"),
    };

    // Scope from those fields, now and at the coming high water — it matters
    // most here, while the rode is still being chosen. Poor scope is advice,
    // never a gate on arming.
    const tideLine = this.buildTideLine();
    this.scopeAdvisoryEl = document.createElement("div");
    this.scopeAdvisoryEl.className = "anchor-scope-advisory";
    this.scopeAdvisoryEl.style.display = "none";

    // Watch radius: computed default (rode + boat + GPS margin), manual
    // override always available; Auto returns to the computed value.
    const radiusRow = document.createElement("div");
    radiusRow.className = "anchor-radius-row";
    const radiusLab = document.createElement("span");
    radiusLab.className = "anchor-field-label";
    radiusLab.textContent = "Watch radius";
    this.radiusInput = this.numberInput("anchor-radius-input");
    this.radiusInput.addEventListener("input", () => {
      const v = Number.parseFloat(this.radiusInput.value);
      this.radiusOverrideM =
        Number.isFinite(v) && v > 0 ? fromDisplayLength(v, this.unit()) : null;
      this.renderSetupLive();
    });
    const radiusUnit = document.createElement("span");
    radiusUnit.className = "anchor-field-unit";
    this.unitEls.push(radiusUnit);
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "anchor-radius-auto";
    autoBtn.textContent = "Auto";
    autoBtn.title = "Computed radius: rode + boat length + GPS margin";
    autoBtn.addEventListener("click", () => {
      this.radiusOverrideM = null;
      this.renderSetupLive();
    });
    radiusRow.append(radiusLab, this.radiusInput, radiusUnit, autoBtn);
    this.radiusHint = document.createElement("div");
    this.radiusHint.className = "anchor-radius-hint";

    // Anchor position: at the vessel, offset from it, or a chart tap.
    const posRow = document.createElement("div");
    posRow.className = "anchor-pos-row";
    const posLab = document.createElement("span");
    posLab.className = "anchor-field-label";
    posLab.textContent = "Anchor position";
    posRow.appendChild(posLab);
    const posBtn = (mode: AnchorPosMode, label: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "anchor-pos-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => this.setPosMode(mode));
      posRow.appendChild(btn);
      return btn;
    };
    this.posButtons = {
      vessel: posBtn("vessel", "At vessel"),
      offset: posBtn("offset", "Offset"),
      tap: posBtn("tap", "Tap chart"),
    };
    this.offsetWrap = document.createElement("span");
    this.offsetWrap.className = "anchor-pos-offset";
    this.offsetDistInput = this.numberInput("anchor-offset-dist");
    this.offsetDistInput.setAttribute("aria-label", "Offset distance");
    this.offsetDistInput.addEventListener("input", () => {
      const v = Number.parseFloat(this.offsetDistInput.value);
      if (Number.isFinite(v) && v >= 0) {
        this.offsetDistM = fromDisplayLength(v, this.unit());
      }
      this.renderSetupLive();
    });
    const offsetDistUnit = document.createElement("span");
    offsetDistUnit.className = "anchor-field-unit";
    this.unitEls.push(offsetDistUnit);
    this.offsetBrgInput = this.numberInput("anchor-offset-brg");
    this.offsetBrgInput.max = "360";
    this.offsetBrgInput.setAttribute(
      "aria-label",
      "Offset bearing, degrees true",
    );
    this.offsetBrgInput.addEventListener("input", () => {
      const v = Number.parseFloat(this.offsetBrgInput.value);
      if (Number.isFinite(v)) this.offsetBrgDeg = ((v % 360) + 360) % 360;
      this.renderSetupLive();
    });
    const brgUnit = document.createElement("span");
    brgUnit.className = "anchor-field-unit";
    brgUnit.textContent = "°T";
    this.offsetWrap.append(
      this.offsetDistInput,
      offsetDistUnit,
      this.offsetBrgInput,
      brgUnit,
    );
    posRow.appendChild(this.offsetWrap);
    this.posHint = document.createElement("div");
    this.posHint.className = "anchor-pos-hint";

    // Hold-to-arm with a progress fill (stepped on e-ink, like COB).
    const armBtn = document.createElement("button");
    armBtn.type = "button";
    armBtn.className = "anchor-arm-btn";
    this.armBtn = armBtn;
    const armProgress = document.createElement("span");
    armProgress.className = "anchor-hold-progress";
    const armCount = document.createElement("span");
    armCount.className = "anchor-hold-count";
    const armLabel = document.createElement("span");
    armLabel.textContent = "Hold to arm";
    armBtn.append(armProgress, armLabel, armCount);
    this.armHold = { fill: armProgress, count: armCount };
    this.detachHolds.push(
      attachHoldGesture(armBtn, {
        holdMs: ARM_HOLD_MS,
        stepped: () => getSettings().displayTheme === "eink",
        steppedSteps: () => Math.max(1, holdPips(ARM_HOLD_MS) - 1),
        onStart: () => this.setHoldActive(true),
        onProgress: (frac) => {
          this.renderHoldProgress(armProgress, armCount, frac, ARM_HOLD_MS);
        },
        onComplete: () => {
          this.setHoldActive(false);
          const reason = this.armBlockedReason();
          if (reason !== null) {
            // The press must never die silently: name what's missing, big.
            this.clearHoldProgress(armProgress, armCount);
            showStatusBanner({
              id: "anchor-arm-blocked",
              message: `Not armed — ${reason}`,
              onDismiss: () => {},
            });
            setTimeout(
              () => hideStatusBanner("anchor-arm-blocked"),
              NO_FIX_BANNER_MS,
            );
            return;
          }
          this.renderHoldProgress(armProgress, armCount, 1, ARM_HOLD_MS);
          this.arm();
        },
        onCancel: () => {
          this.clearHoldProgress(armProgress, armCount);
          this.setHoldActive(false);
        },
      }),
    );

    // Why arming is unavailable, when it is — arming must never be a
    // half-commitment, so the reason shows before the button is pressed.
    this.armBlockedEl = document.createElement("div");
    this.armBlockedEl.className = "anchor-arm-blocked";
    this.setupEl.append(
      fields,
      tideLine,
      this.scopeAdvisoryEl,
      radiusRow,
      this.radiusHint,
      posRow,
      this.posHint,
      this.armBlockedEl,
      armBtn,
    );
    this.renderSetupValues();
    this.setPosMode("vessel");
  }

  private buildArmed(): void {
    this.armedEl = document.createElement("div");
    this.armedEl.className = "anchor-armed";
    this.armedEl.style.display = "none";

    const distRow = document.createElement("div");
    distRow.className = "anchor-dist-row";
    this.distEl = document.createElement("div");
    this.distEl.className = "anchor-dist";
    this.distEl.textContent = "--";
    const brgWrap = document.createElement("div");
    brgWrap.className = "anchor-brg-wrap";
    const brgLab = document.createElement("div");
    brgLab.className = "anchor-cell-label";
    brgLab.textContent = "BRG TO ANCHOR";
    this.brgEl = document.createElement("span");
    this.brgEl.className = "anchor-brg";
    this.brgEl.textContent = "--";
    brgWrap.append(brgLab, this.brgEl);
    distRow.append(this.distEl, brgWrap);

    // Radius with quick adjust.
    const radiusCell = document.createElement("div");
    radiusCell.className = "anchor-radius-adjust";
    const radiusLab = document.createElement("span");
    radiusLab.className = "anchor-cell-label";
    radiusLab.textContent = "RADIUS";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "anchor-radius-minus";
    minus.setAttribute("aria-label", "Decrease watch radius");
    minus.textContent = "−";
    this.radiusValueEl = document.createElement("span");
    this.radiusValueEl.className = "anchor-radius-value";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "anchor-radius-plus";
    plus.setAttribute("aria-label", "Increase watch radius");
    plus.textContent = "+";
    const adjust = (dir: 1 | -1) => {
      const snap = this.deps.manager.getState();
      if (!snap) return;
      const next = snap.radiusM + dir * radiusStepM(this.unit());
      this.deps.manager.updateRadius(Math.max(MIN_RADIUS_M, next));
    };
    minus.addEventListener("click", () => adjust(-1));
    plus.addEventListener("click", () => adjust(1));
    radiusCell.append(radiusLab, minus, this.radiusValueEl, plus);

    this.gpsLineEl = document.createElement("div");
    this.gpsLineEl.className = "anchor-gps-line";
    // Screen-off cover and alarm-audibility disclosures — see renderAdvisory().
    this.advisoryEl = document.createElement("div");
    this.advisoryEl.className = "anchor-advisory-line";
    this.advisoryEl.style.display = "none";
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "anchor-countdown";

    const tideLine = this.buildTideLine();

    this.audioEl = document.createElement("div");
    this.audioEl.className = "anchor-audio-blocked";
    this.audioEl.textContent = "🔇 Tap to enable alarm sound";
    this.audioEl.style.display = "none";

    const actions = document.createElement("div");
    actions.className = "anchor-actions";
    this.muteBtn = document.createElement("button");
    this.muteBtn.type = "button";
    this.muteBtn.className = "anchor-panel-btn";
    this.muteBtn.addEventListener("click", () => {
      const snap = this.deps.manager.getState();
      if (snap) this.deps.manager.setMuted(!snap.muted);
    });
    const disarmBtn = this.buildDisarmButton("Hold to disarm");
    actions.append(this.muteBtn, disarmBtn);

    this.armedEl.append(
      distRow,
      radiusCell,
      this.countdownEl,
      this.gpsLineEl,
      this.advisoryEl,
      tideLine,
      this.audioEl,
      actions,
    );
  }

  /**
   * Show hold progress without repainting a wide region.
   *
   * The sliding fill changes an element's width, which forces layout and
   * repaints the whole bar — on e-ink that is a visible flash several times
   * per hold. There a short row of pips is used instead, filling as the hold
   * progresses: it dirties a few characters, and unlike a bare numeral it
   * cannot be misread as a seconds countdown (the steps span the hold, which
   * is 0.6 s to arm and 1.5 s to disarm).
   */
  private renderHoldProgress(
    fill: HTMLSpanElement,
    count: HTMLSpanElement,
    frac: number,
    holdMs: number,
  ): void {
    if (getSettings().displayTheme === "eink") {
      // The press lights the first pip — waiting for a step to elapse leaves
      // the button looking dead exactly when the user needs to know it
      // registered — and the last lights as the action fires, so the pips
      // span the hold rather than running out early. The gesture is asked
      // for one fewer step than there are pips to make that line up.
      const pipCount = holdPips(holdMs);
      const filled = Math.min(pipCount, 1 + Math.round(frac * (pipCount - 1)));
      const pips = "●".repeat(filled) + "○".repeat(pipCount - filled);
      // Only on change: the gesture reports more steps than there are pips,
      // and a redundant write still dirties the node — which here costs a
      // whole panel refresh.
      if (count.textContent !== pips) count.textContent = pips;
      return;
    }
    fill.style.width = `${frac * 100}%`;
  }

  /** Wipe the hold indicator; the gesture ended, however it ended. */
  private clearHoldProgress(
    fill: HTMLSpanElement,
    count: HTMLSpanElement,
  ): void {
    if (count.textContent !== "") count.textContent = "";
    fill.style.width = "0%";
  }

  private buildDisarmButton(label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "anchor-panel-btn anchor-disarm-btn";
    const progress = document.createElement("span");
    progress.className = "anchor-hold-progress";
    const count = document.createElement("span");
    count.className = "anchor-hold-count";
    const text = document.createElement("span");
    text.textContent = label;
    btn.append(progress, text, count);
    this.disarmHolds.push({ fill: progress, count });
    // On the alarm banner a click on this button must not double as the
    // tap-to-acknowledge.
    btn.addEventListener("click", (e) => e.stopPropagation());
    this.detachHolds.push(
      attachHoldGesture(btn, {
        holdMs: DISARM_HOLD_MS,
        stepped: () => getSettings().displayTheme === "eink",
        steppedSteps: () => Math.max(1, holdPips(DISARM_HOLD_MS) - 1),
        onStart: () => this.setHoldActive(true),
        onProgress: (frac) => {
          this.renderHoldProgress(progress, count, frac, DISARM_HOLD_MS);
        },
        onComplete: () => {
          this.renderHoldProgress(progress, count, 1, DISARM_HOLD_MS);
          this.setHoldActive(false);
          this.deps.manager.disarm();
        },
        onCancel: () => {
          this.clearHoldProgress(progress, count);
          this.setHoldActive(false);
        },
      }),
    );
    return btn;
  }

  private buildAlarmBanner(): void {
    this.alarmTitle = document.createElement("div");
    this.alarmTitle.className = "anchor-alarm-title";
    this.alarmDetail = document.createElement("div");
    this.alarmDetail.className = "anchor-alarm-detail";
    const hint = document.createElement("div");
    hint.className = "anchor-alarm-hint";
    hint.textContent = "Tap to silence — watch stays armed";
    const disarm = this.buildDisarmButton("Hold to disarm");
    this.alarmEl.append(this.alarmTitle, this.alarmDetail, hint, disarm);
    // Tap anywhere on the banner = acknowledge this event.
    this.alarmEl.addEventListener("click", () =>
      this.deps.manager.acknowledge(),
    );
  }

  // --- State handling ---

  private onWatchChange(snap: AnchorWatchSnapshot | null): void {
    const newlyArmed = snap !== null && this.snap === null;
    this.snap = snap;
    if (this.holdActive) {
      // Mid-hold: remember only that a repaint is owed; setHoldActive
      // replays the latest state when the gesture ends. Repainting now
      // would refresh the panel under the user's finger (see renderTick).
      this.pendingWatchSnap = true;
      this.renderAlarm(snap);
      return;
    }
    // A new watch gets a fresh verdict; the last one described a service that
    // may not even have been running.
    if (!snap || newlyArmed) this.advisoryText = null;
    if (newlyArmed) this.refreshAdvisory(true);
    this.renderAdvisory();
    this.el.dataset.armed = snap ? "1" : "0";
    if (snap) this.el.dataset.zone = snap.zone;
    else {
      delete this.el.dataset.zone;
      this.elapsedEl.textContent = "";
    }
    // A completed hold deliberately leaves its pips filled — clear them as
    // the views swap, or the next view opens showing the last gesture's
    // finished indicator (all pips lit on "Hold to arm" right after a
    // disarm).
    if (this.armHold)
      this.clearHoldProgress(this.armHold.fill, this.armHold.count);
    for (const h of this.disarmHolds) this.clearHoldProgress(h.fill, h.count);
    this.setupEl.style.display = snap ? "none" : "";
    this.armedEl.style.display = snap ? "" : "none";
    if (snap) this.renderArmed(snap);
    else if (this.modeActive) this.renderSetupLive();
    this.renderAlarm(snap);
    this.renderAudioBlocked();
    this.updateTicker();
  }

  private readonly onFix = (): void => {
    if (!this.modeActive || this.deps.manager.isArmed()) return;
    // Setup view: the auto radius tracks live GPS margin, and the vessel/
    // offset preview follows the boat.
    this.renderSetupLive();
  };

  private unit(): AnchorLengthUnit {
    return anchorLengthUnit(getSettings().depthUnit);
  }

  private effectiveRadiusM(): number {
    return this.radiusOverrideM ?? this.autoRadiusM();
  }

  /**
   * Watch radius for the widest swing expected during the watch. The boat
   * reaches furthest at low water — less depth means a flatter rode — so
   * the entered depth is reduced by the fall to the lowest low water in the
   * tide window when that is known. A depth that would go non-positive is
   * clamped just above zero; the grounding case is the advisory's business,
   * not the radius formula's.
   */
  private autoRadiusM(): number {
    const fix = this.deps.navManager.getLastData();
    const margin = gpsMarginM(
      fix?.accuracy ?? null,
      this.deps.navManager.getQualitySignals().scatterM,
    );
    return defaultRadiusM(
      this.params.lastRodeM,
      this.params.boatLengthM,
      margin,
      this.depthAtLowWaterM(),
      this.params.bowHeightM,
    );
  }

  /** The entered depth would be gone by low water — a grounding risk. */
  private groundsAtLowWater(): boolean {
    const depth = this.params.lastDepthM;
    if (depth === undefined || depth <= 0) return false;
    const outlook = this.tideCache?.outlook;
    if (!outlook || outlook.kind !== "high" || outlook.dropM === null) {
      return false;
    }
    return outlook.dropM >= depth;
  }

  /** Entered depth less the predicted fall to low water, when available. */
  private depthAtLowWaterM(): number | undefined {
    const depth = this.params.lastDepthM;
    if (depth === undefined || depth <= 0) return depth;
    const outlook = this.tideCache?.outlook;
    if (!outlook || outlook.kind !== "high" || outlook.dropM === null) {
      return depth;
    }
    return Math.max(0.1, depth - outlook.dropM);
  }

  private resolveAnchorPosition(): { lat: number; lon: number } | null {
    if (this.posMode === "tap") return this.tapped;
    const fix = this.deps.navManager.getLastData();
    if (!fix) return null;
    if (this.posMode === "vessel") {
      return { lat: fix.latitude, lon: fix.longitude };
    }
    const [lon, lat] = projectPoint(
      fix.latitude,
      fix.longitude,
      this.offsetBrgDeg,
      this.offsetDistM / NM_TO_METERS,
    );
    return { lat, lon };
  }

  private setPosMode(mode: AnchorPosMode): void {
    this.posMode = mode;
    for (const [m, btn] of Object.entries(this.posButtons)) {
      btn.classList.toggle("active", m === mode);
      btn.setAttribute("aria-pressed", String(m === mode));
    }
    this.offsetWrap.style.display = mode === "offset" ? "" : "none";
    this.renderSetupLive();
  }

  private arm(): void {
    const pos = this.resolveAnchorPosition();
    if (!pos) {
      showStatusBanner({
        id: "anchor-no-fix",
        message: "No GPS fix — cannot place the anchor",
        onDismiss: () => {},
      });
      setTimeout(() => hideStatusBanner("anchor-no-fix"), NO_FIX_BANNER_MS);
      return;
    }
    this.deps.manager.arm({
      lat: pos.lat,
      lon: pos.lon,
      radiusM: Math.max(MIN_RADIUS_M, this.effectiveRadiusM()),
    });
  }

  // --- Rendering ---

  /** Fill every setup input from stored meters (unit change, first build). */
  private renderSetupValues(): void {
    const unit = this.unit();
    for (const el of this.unitEls) el.textContent = unit;
    const fill = (input: HTMLInputElement, meters: number | undefined) => {
      input.value =
        meters !== undefined ? String(toDisplayLength(meters, unit)) : "";
    };
    fill(this.paramInputs.boatLengthM, this.params.boatLengthM);
    fill(this.paramInputs.bowHeightM, this.params.bowHeightM);
    fill(this.paramInputs.lastRodeM, this.params.lastRodeM);
    fill(this.paramInputs.lastDepthM, this.params.lastDepthM);
    fill(this.offsetDistInput, this.offsetDistM);
    this.offsetBrgInput.value = String(Math.round(this.offsetBrgDeg));
    this.radiusInput.value = String(
      toDisplayLength(this.effectiveRadiusM(), unit),
    );
    this.renderSetupLive();
  }

  /** Live parts of the setup view: auto radius, margin hint, placement. */
  private renderSetupLive(): void {
    const unit = this.unit();
    const fix = this.deps.navManager.getLastData();
    const margin = gpsMarginM(
      fix?.accuracy ?? null,
      this.deps.navManager.getQualitySignals().scatterM,
    );
    // Keep the input tracking the computed default while on auto — but never
    // retype under the user's cursor.
    if (
      this.radiusOverrideM === null &&
      document.activeElement !== this.radiusInput
    ) {
      this.radiusInput.value = String(
        toDisplayLength(this.autoRadiusM(), unit),
      );
    }
    this.radiusHint.textContent =
      this.radiusOverrideM === null
        ? this.params.lastDepthM
          ? `Auto: swing reach + boat length + GPS margin (${formatLength(margin, unit)})`
          : `Auto: rode + boat length + GPS margin (${formatLength(margin, unit)}) — enter depth to use true swing reach`
        : `Manual — Auto would be ${formatLength(this.autoRadiusM(), unit)}`;
    this.posHint.textContent =
      this.posMode === "tap"
        ? this.tapped
          ? "Anchor placed — tap the chart again to move it"
          : "Tap the chart to place the anchor"
        : this.posMode === "offset"
          ? "Anchor set at the given distance and bearing from the vessel"
          : fix
            ? ""
            : "Waiting for a GPS fix";
    this.applyArmBlocker();
    this.renderScope();
    this.deps.onPreviewChange();
  }

  /**
   * A watch with no position source cannot watch anything, so arming is
   * blocked until a fix exists (and the tap/offset modes still need one to
   * measure from). The reason is stated in place rather than surfacing
   * after the fact.
   */
  private armBlockedReason(): string | null {
    const fix = this.deps.navManager.getLastData();
    if (!fix) return "Waiting for a GPS fix — the watch needs a position.";
    if (this.deps.navManager.isFixStale()) {
      return "GPS fix is stale — waiting for a current position.";
    }
    if (this.posMode === "tap" && !this.tapped) {
      return "Tap the chart to place the anchor.";
    }
    const radiusM = this.effectiveRadiusM();
    if (accuracyTooVagueToArm(fix.accuracy, radiusM)) {
      const unit = this.unit();
      return `GPS accuracy is ${formatLength(fix.accuracy ?? 0, unit)} — too vague for a ${formatLength(radiusM, unit)} watch circle. Wait for a better fix.`;
    }
    return null;
  }

  private applyArmBlocker(): void {
    const reason = this.armBlockedReason();
    if (this.armBtn) {
      // Never the `disabled` attribute: disabled buttons swallow pointer
      // events, so a blocked press produced no response whatsoever — which
      // on e-ink read as a successful arm (field-caught: user believed a
      // watch was armed, screen off, twenty minutes unprotected). The
      // button stays pressable; a press while blocked answers loudly
      // instead of arming (see the arm hold's onComplete).
      this.armBtn.classList.toggle("blocked", reason !== null);
      this.armBtn.setAttribute("aria-disabled", String(reason !== null));
    }
    if (this.armBlockedEl) {
      this.armBlockedEl.textContent = reason ?? "";
      this.armBlockedEl.style.display = reason ? "" : "none";
    }
  }

  private renderArmed(snap: AnchorWatchSnapshot): void {
    const settings = getSettings();
    const unit = this.unit();
    this.distEl.textContent =
      snap.distanceM !== null
        ? formatDistanceNM(snap.distanceM / NM_TO_METERS, settings.depthUnit)
        : "--";
    this.brgEl.textContent =
      snap.bearingDeg !== null
        ? formatBearing(
            snap.bearingDeg,
            settings.bearingMode,
            snap.anchor.lat,
            snap.anchor.lon,
          )
        : "--";
    this.radiusValueEl.textContent = formatLength(snap.radiusM, unit);
    this.gpsLineEl.dataset.state = snap.gpsState;
    const fix = this.deps.navManager.getLastData();
    const acc =
      snap.gpsState === "ok" || snap.gpsState === "poor"
        ? fix?.accuracy != null
          ? ` (±${formatLength(fix.accuracy, unit)})`
          : ""
        : "";
    this.gpsLineEl.textContent = `${GPS_STATE_TEXT[snap.gpsState]}${acc}`;
    // Outside the radius but not yet alarming: show the excursion timer, so
    // a countdown that keeps restarting on GPS jitter near the boundary
    // reads as "working" rather than "broken".
    if (snap.alarmInS !== null) {
      this.countdownEl.textContent = `Outside the circle — alarm in ${snap.alarmInS}s`;
      this.countdownEl.style.display = "";
    } else {
      this.countdownEl.textContent = "";
      this.countdownEl.style.display = "none";
    }
    this.muteBtn.textContent = snap.muted ? "Unmute alarms" : "Mute alarms";
    this.renderTick();
  }

  /**
   * Hold off swapping the card and the alarm banner while a hold is in
   * progress. They share the bottom-center strip, so showing one hides the
   * other — and hiding the element under the user's finger drops its pointer
   * capture, cancelling the hold. With a small radius and jittery GPS the
   * alarm can clear and re-fire repeatedly, which made disarming take
   * several attempts. The swap runs as soon as the hold ends.
   */
  private setHoldActive(active: boolean): void {
    if (this.holdActive === active) return;
    this.holdActive = active;
    if (active) return;
    if (this.pendingWatchSnap) {
      this.pendingWatchSnap = false;
      this.onWatchChange(this.deps.manager.getState());
      return;
    }
    const pending = this.pendingAlarmSnap;
    if (pending !== undefined) {
      this.pendingAlarmSnap = undefined;
      this.renderAlarm(pending);
    }
  }

  private renderAlarm(snap: AnchorWatchSnapshot | null): void {
    if (this.holdActive) {
      this.pendingAlarmSnap = snap;
      return;
    }
    // Both surfaces share the bottom-center strip; the card steps aside
    // while the banner is up (style.css hides it via this class).
    this.el.classList.toggle("anchor-alarm-showing", snap?.alarming === true);
    if (!snap?.alarming) {
      this.alarmEl.classList.remove("open");
      return;
    }
    this.alarmEl.dataset.kind = snap.alarmKind ?? "";
    if (snap.alarmKind === "gps-loss") {
      this.alarmTitle.textContent = "GPS SIGNAL LOST";
      this.alarmDetail.textContent =
        "No position data — the watch cannot see the boat";
    } else if (snap.alarmKind === "watch-failure") {
      // The meta-alarm: the watch itself is compromised — say what to check.
      this.alarmTitle.textContent = "ANCHOR WATCH IMPAIRED";
      this.alarmDetail.textContent =
        snap.watchFailureReason === "device-battery"
          ? "Battery low on this device — charge it or the watch may die"
          : "Nothing is watching the anchor — no GPS fix and the app was asleep";
    } else {
      this.alarmTitle.textContent = "ANCHOR DRAGGING";
      this.alarmDetail.textContent = `${
        snap.distanceM !== null
          ? formatDistanceNM(
              snap.distanceM / NM_TO_METERS,
              getSettings().depthUnit,
            )
          : "--"
      } from anchor — watch radius ${formatLength(snap.radiusM, this.unit())}`;
    }
    if (!this.alarmEl.classList.contains("open")) {
      this.alarmEl.classList.add("open");
      this.alarmSurface.opened();
    }
  }

  // --- Armed disclosures ---

  /**
   * Ask the native watch whether it can actually see the boat, and whether
   * the alarm stream is loud enough to be heard. Throttled to
   * {@link ADVISORY_POLL_MS} and driven off the panel's existing 1 Hz ticker, so
   * it costs one bridge call per 15 s of armed panel time and nothing at all
   * on web or while the panel is closed.
   */
  private refreshAdvisory(force = false): void {
    if (!this.snap || this.advisoryPending) return;
    const now = Date.now();
    if (!force && now - this.advisoryCheckedAt < ADVISORY_POLL_MS) return;
    this.advisoryCheckedAt = now;
    this.advisoryPending = true;
    getNativeAnchorStatus().then(
      (status) => {
        this.advisoryPending = false;
        if (this.disposed) return;
        // How long this side has been armed: the service needs a moment to
        // start, and "not running yet" must not read as "not covered".
        const armedForMs = this.snap ? Date.now() - this.snap.armedAt : 0;
        this.advisoryText = armedAdvisoryLine(status, armedForMs);
        this.renderAdvisory();
      },
      () => {
        this.advisoryPending = false;
      },
    );
  }

  /**
   * The standing disclosures: nothing is watching once the screen goes off,
   * and/or the alarm stream is too quiet to wake anyone. A persistent line
   * rather than a banner — these are standing conditions of this watch on
   * this device, not events, and the user's response is to plan around them
   * (leave the app up, move the tablet, turn the alarm volume up) rather than
   * to dismiss them. Neither is ever a gate on arming: a watch that only runs
   * while the app is awake is still a watch, and a quiet alarm is still an
   * alarm.
   *
   * Armed view only. Before arming there is nothing to report: the service is
   * usually not running, so it has neither a fix nor a chance at one, and the
   * permission it needs is requested by the arm itself — a pre-arm warning
   * would either be permanently pessimistic or tell the user to fix something
   * arming fixes for them.
   */
  private renderAdvisory(): void {
    const text = this.snap ? this.advisoryText : null;
    this.advisoryEl.textContent = text ?? "";
    this.advisoryEl.style.display = text ? "" : "none";
  }

  private renderAudioBlocked(): void {
    const blocked =
      this.deps.manager.isArmed() &&
      this.deps.alarms.some((a) => a.isBlocked());
    this.audioEl.style.display = blocked ? "" : "none";
  }

  // --- Tide-aware scope ---

  /** Where the scope readout asks about the tide: the anchor, else the boat. */
  private scopePosition(): { lat: number; lon: number } | null {
    const snap = this.snap;
    if (snap) return snap.anchor;
    const pending = this.resolveAnchorPosition();
    if (pending) return pending;
    const fix = this.deps.navManager.getLastData();
    return fix ? { lat: fix.latitude, lon: fix.longitude } : null;
  }

  /**
   * Start the one-time bundle load. A failure is remembered rather than
   * retried on every tick; the panel stays usable either way.
   */
  private ensureTideIndex(): void {
    if (this.tideIndex || this.tideLoading || this.tideLoadFailed) return;
    // The bundle is megabytes — wait until the card is actually on screen.
    // The promise is shared with the tides overlay, so it may cost nothing.
    if (!this.modeActive) return;
    this.tideLoading = true;
    const gen = ++this.tideLoadGen;
    loadTidesIndex().then(
      (index) => {
        if (this.disposed || gen !== this.tideLoadGen) return;
        this.tideLoading = false;
        this.tideIndex = index;
        this.renderScope();
      },
      (err: unknown) => {
        if (this.disposed || gen !== this.tideLoadGen) return;
        this.tideLoading = false;
        this.tideLoadFailed = true;
        console.warn("anchor scope: tides bundle unavailable:", err);
        this.renderScope();
      },
    );
  }

  /** Cached coming-high-water outlook for the current anchor position. */
  private tideOutlook(at: Date): TideOutlook {
    const pos = this.scopePosition();
    if (!pos) return { kind: "no-position" };
    if (this.tideLoadFailed) return { kind: "unavailable" };
    const index = this.tideIndex;
    if (!index) {
      this.ensureTideIndex();
      return { kind: "loading" };
    }
    const key = `${pos.lat.toFixed(TIDE_POS_DECIMALS)},${pos.lon.toFixed(
      TIDE_POS_DECIMALS,
    )}`;
    const cached = this.tideCache;
    const fresh =
      cached !== null &&
      cached.key === key &&
      at.getTime() - cached.computedAt < TIDE_REFRESH_MS &&
      (cached.outlook.kind !== "high" ||
        cached.outlook.time.getTime() > at.getTime());
    if (cached && fresh) return cached.outlook;
    const outlook = this.computeTideOutlook(index, pos, at);
    this.tideCache = { key, computedAt: at.getTime(), outlook };
    return outlook;
  }

  private computeTideOutlook(
    index: TidesIndex,
    pos: { lat: number; lon: number },
    at: Date,
  ): TideOutlook {
    const station = nearestTideStation(index, pos.lat, pos.lon);
    if (!station) return { kind: "no-station" };
    let state: TideState | null = null;
    try {
      state = tideState(station, index, at, TIDE_LOOKAHEAD_HRS);
    } catch (err) {
      console.warn("anchor scope: tide prediction failed:", err);
    }
    if (!state || state.heightMeters === null) return { kind: "no-prediction" };
    const hw = highestHighWithin(
      state.events,
      at,
      TIDE_LOOKAHEAD_HRS * HOUR_MS,
    );
    if (!hw) return { kind: "no-high" };
    const lw = lowestLowWithin(state.events, at, TIDE_LOOKAHEAD_HRS * HOUR_MS);
    return {
      kind: "high",
      riseM: riseToHigh(state.heightMeters, hw.heightMeters),
      time: hw.time,
      approximate: state.approximate === true,
      stationName: station.name,
      dropM: lw ? dropToLow(state.heightMeters, lw.heightMeters) : null,
    };
  }

  /**
   * "Scope 5.2:1 now → 3.8:1 at HW 4:12 PM" when everything is known; a short
   * statement of what is missing otherwise — this line never goes blank.
   */
  private scopeReadout(): ScopeReadout {
    const { lastRodeM: rodeM, lastDepthM: depthM, bowHeightM } = this.params;
    const now = scopeRatio({ rodeM, depthM, bowHeightM });
    if (now === null) {
      return {
        text: missingScopeInputs(rodeM, depthM, bowHeightM),
        advice: "none",
        detail: "",
        advisory: null,
      };
    }
    const at = new Date();
    const nowText = `Scope ${formatScopeRatio(now)} now`;
    const nowAdvice = scopeAdvice(now);
    const notes: string[] = [];
    if (bowHeightM === undefined) {
      notes.push("Bow height not set — counted as zero.");
    }
    const outlook = this.tideOutlook(at);
    if (outlook.kind !== "high") {
      return {
        text: `${nowText} · ${TIDE_OUTLOOK_NOTE[outlook.kind]}`,
        advice: nowAdvice ?? "none",
        detail: notes.join(" "),
        advisory: nowAdvice === "poor" ? POOR_SCOPE_ADVISORY : null,
      };
    }

    const atHw = scopeAtTide({
      rodeM,
      depthM,
      bowHeightM,
      tideRiseM: outlook.riseM,
    });
    const hwAdvice = scopeAdvice(atHw);
    const depthUnit = getSettings().depthUnit;
    notes.unshift(
      `${outlook.stationName}: +${formatTideHeight(outlook.riseM, depthUnit)} by high water ${formatTimeUntil(outlook.time, at)}.`,
    );
    if (outlook.approximate) {
      notes.push("Subordinate station — offset estimate, not a curve.");
    }
    const worst = worstAdvice(nowAdvice, hwAdvice);
    return {
      text:
        atHw === null
          ? `${nowText} · ${TIDE_OUTLOOK_NOTE["no-prediction"]}`
          : `${nowText} → ${formatScopeRatio(atHw)} at HW ${formatEventTime(
              outlook.time,
              at,
            )}${outlook.approximate ? " (approx.)" : ""}`,
      advice: worst ?? "none",
      detail: notes.join(" "),
      advisory: this.groundsAtLowWater()
        ? GROUNDING_ADVISORY
        : hwAdvice === "poor" && nowAdvice !== "poor"
          ? POOR_AT_HW_ADVISORY
          : worst === "poor"
            ? POOR_SCOPE_ADVISORY
            : null,
    };
  }

  private renderScope(): void {
    const readout = this.scopeReadout();
    for (const el of this.tideEls) {
      el.textContent = readout.text;
      el.dataset.advice = readout.advice;
      if (readout.detail) el.title = readout.detail;
      else el.removeAttribute("title");
    }
    this.scopeAdvisoryEl.textContent = readout.advisory ?? "";
    this.scopeAdvisoryEl.style.display = readout.advisory ? "" : "none";
  }

  /** 1 Hz while the panel is visible: time at anchor, arm gate, scope, cover. */
  private renderTick(): void {
    // Nothing repaints under a finger mid-hold: every DOM write costs an
    // e-ink refresh, and refreshes make the digitizer drop the contact —
    // which cancelled disarm holds repeatedly in the field. One or two
    // skipped ticks of elapsed-time display is free.
    if (this.holdActive) return;
    const snap = this.snap;
    if (snap) {
      this.elapsedEl.textContent = formatCobElapsed(Date.now() - snap.armedAt);
      // Self-throttling; the plugin is asked once per ADVISORY_POLL_MS.
      this.refreshAdvisory();
    } else {
      // Setup view: a fix can go stale with no event to announce it, so the
      // arm gate is re-evaluated on the clock.
      this.applyArmBlocker();
    }
    // Cheap on most ticks — the tide prediction behind it is cached.
    this.renderScope();
  }

  private updateTicker(): void {
    const wanted = this.modeActive;
    if (wanted && !this.ticker) {
      this.ticker = setInterval(() => this.renderTick(), 1000);
    } else if (!wanted && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.ticker) clearInterval(this.ticker);
    for (const detach of this.detachHolds) detach();
    this.detachHolds = [];
    this.deps.navManager.unsubscribe(this.onFix);
    this.el.remove();
    this.alarmEl.remove();
  }
}
