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
 */

import type { CobAlarm } from "../cob/CobAlarm";
import { formatCobElapsed } from "../cob/cob-state";
import { attachHoldGesture } from "../cob/hold-gesture";
import type { AnchorLayerState } from "../map/AnchorLayer";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { getSettings, onSettingsChange } from "../settings";
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
  type AnchorLengthUnit,
  anchorLengthUnit,
  defaultRadiusM,
  formatLength,
  fromDisplayLength,
  gpsMarginM,
  radiusStepM,
  toDisplayLength,
} from "./anchor-setup";
import { type AnchorRememberedParams, anchorParamsSlot } from "./anchor-state";

/** Arming is deliberate but not an emergency — a short guarded hold. */
const ARM_HOLD_MS = 600;
/** Standing the watch down gets COB-grade friction. */
const DISARM_HOLD_MS = 1500;
const MIN_RADIUS_M = 5;
const NO_FIX_BANNER_MS = 8000;

type AnchorPosMode = "vessel" | "offset" | "tap";

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
  /** Both alarm instances, for blocked-audio detection and gesture unlock. */
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
  private ticker: ReturnType<typeof setInterval> | null = null;
  private detachHolds: Array<() => void> = [];

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

  // Armed elements
  private armedEl!: HTMLDivElement;
  private elapsedEl!: HTMLSpanElement;
  private distEl!: HTMLDivElement;
  private brgEl!: HTMLSpanElement;
  private radiusValueEl!: HTMLSpanElement;
  private gpsLineEl!: HTMLDivElement;
  private tideEl!: HTMLDivElement;
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
      if (!this.snap) this.renderSetupLive();
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
    const armProgress = document.createElement("span");
    armProgress.className = "anchor-hold-progress";
    const armLabel = document.createElement("span");
    armLabel.textContent = "Hold to arm";
    armBtn.append(armProgress, armLabel);
    this.detachHolds.push(
      attachHoldGesture(armBtn, {
        holdMs: ARM_HOLD_MS,
        stepped: () => getSettings().displayTheme === "eink",
        onProgress: (frac) => {
          armProgress.style.width = `${frac * 100}%`;
        },
        onComplete: () => {
          armProgress.style.width = "0%";
          this.arm();
        },
        onCancel: () => {
          armProgress.style.width = "0%";
        },
      }),
    );

    this.setupEl.append(
      fields,
      radiusRow,
      this.radiusHint,
      posRow,
      this.posHint,
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

    // TODO: tide-aware scope readout ("6:1 now → 4.2:1 at HW 04:12") — see
    // docs/anchor-watch-design.md "Tide-aware scope". Inputs already exist
    // here (rode, depth, bow height) plus nearestTideStation; a later step
    // fills this line and unhides it.
    this.tideEl = document.createElement("div");
    this.tideEl.className = "anchor-tide";
    this.tideEl.style.display = "none";

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
      this.gpsLineEl,
      this.tideEl,
      this.audioEl,
      actions,
    );
  }

  private buildDisarmButton(label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "anchor-panel-btn anchor-disarm-btn";
    const progress = document.createElement("span");
    progress.className = "anchor-hold-progress";
    const text = document.createElement("span");
    text.textContent = label;
    btn.append(progress, text);
    // On the alarm banner a click on this button must not double as the
    // tap-to-acknowledge.
    btn.addEventListener("click", (e) => e.stopPropagation());
    this.detachHolds.push(
      attachHoldGesture(btn, {
        holdMs: DISARM_HOLD_MS,
        stepped: () => getSettings().displayTheme === "eink",
        onProgress: (frac) => {
          progress.style.width = `${frac * 100}%`;
        },
        onComplete: () => {
          progress.style.width = "0%";
          this.deps.manager.disarm();
        },
        onCancel: () => {
          progress.style.width = "0%";
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
    this.snap = snap;
    this.el.dataset.armed = snap ? "1" : "0";
    if (snap) this.el.dataset.zone = snap.zone;
    else {
      delete this.el.dataset.zone;
      this.elapsedEl.textContent = "";
    }
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
    );
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
        ? `Auto: rode + boat length + GPS margin (${formatLength(margin, unit)})`
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
    this.deps.onPreviewChange();
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
    this.muteBtn.textContent = snap.muted ? "Unmute alarms" : "Mute alarms";
    this.renderTick();
  }

  private renderAlarm(snap: AnchorWatchSnapshot | null): void {
    // Both surfaces share the bottom-center strip; the card steps aside
    // while the banner is up (style.css hides it via this class).
    this.el.classList.toggle("anchor-alarm-showing", snap?.alarming === true);
    if (!snap?.alarming) {
      this.alarmEl.classList.remove("open");
      return;
    }
    const gpsLoss = snap.alarmKind === "gps-loss";
    this.alarmEl.dataset.kind = snap.alarmKind ?? "";
    this.alarmTitle.textContent = gpsLoss
      ? "GPS SIGNAL LOST"
      : "ANCHOR DRAGGING";
    this.alarmDetail.textContent = gpsLoss
      ? "No position data — the watch cannot see the boat"
      : `${
          snap.distanceM !== null
            ? formatDistanceNM(
                snap.distanceM / NM_TO_METERS,
                getSettings().depthUnit,
              )
            : "--"
        } from anchor — watch radius ${formatLength(snap.radiusM, this.unit())}`;
    if (!this.alarmEl.classList.contains("open")) {
      this.alarmEl.classList.add("open");
      this.alarmSurface.opened();
    }
  }

  private renderAudioBlocked(): void {
    const blocked =
      this.deps.manager.isArmed() &&
      this.deps.alarms.some((a) => a.isBlocked());
    this.audioEl.style.display = blocked ? "" : "none";
  }

  /** 1 Hz while the armed view is visible: time at anchor. */
  private renderTick(): void {
    const snap = this.snap;
    if (!snap) return;
    this.elapsedEl.textContent = formatCobElapsed(Date.now() - snap.armedAt);
  }

  private updateTicker(): void {
    const wanted = this.snap !== null && this.modeActive;
    if (wanted && !this.ticker) {
      this.ticker = setInterval(() => this.renderTick(), 1000);
    } else if (!wanted && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker);
    for (const detach of this.detachHolds) detach();
    this.detachHolds = [];
    this.deps.navManager.unsubscribe(this.onFix);
    this.el.remove();
    this.alarmEl.remove();
  }
}
