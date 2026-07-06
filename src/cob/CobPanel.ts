/**
 * Crew-overboard info panel: a non-blocking card docked bottom-center while
 * a COB event is active. Shows the mayday essentials — drop-point coordinates
 * in DDM, elapsed time, bearing/distance back, vessel SOG/COG — plus alarm
 * mute and a guarded "Recovered" resolve action.
 *
 * Bearing/distance are computed here from the raw fix and the waypoint, not
 * taken from ActiveNavigation, so the panel keeps guiding even if the user
 * deliberately navigates somewhere else mid-event.
 */

import { computeNavigation } from "../navigation/ActiveNavigation";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { getSettings } from "../settings";
import { formatLatLon } from "../utils/coordinates";
import { formatBearing } from "../utils/magnetic";
import { convertSpeed, formatDistanceNM, speedUnitLabel } from "../utils/units";
import type { CobAlarm } from "./CobAlarm";
import type { CobManager, CobRuntimeState } from "./CobManager";
import { formatCobElapsed } from "./cob-state";
import { attachHoldGesture } from "./hold-gesture";

const HOLD_MS = 1500;

export class CobPanel {
  private readonly el: HTMLDivElement;
  private readonly manager: CobManager;
  private readonly navManager: Pick<
    NavigationDataManager,
    "getLastData" | "isFixStale" | "subscribe" | "unsubscribe"
  >;
  private readonly alarm: CobAlarm;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private collapsed = false;
  private detachResolveHold: (() => void) | null = null;

  // Live elements
  private elapsedEl!: HTMLSpanElement;
  private latEl!: HTMLDivElement;
  private lonEl!: HTMLDivElement;
  private brgEl!: HTMLSpanElement;
  private dstEl!: HTMLSpanElement;
  private sogEl!: HTMLSpanElement;
  private cogEl!: HTMLSpanElement;
  private warnEl!: HTMLDivElement;
  private audioEl!: HTMLDivElement;
  private muteBtn!: HTMLButtonElement;
  private renavBtn!: HTMLButtonElement;
  private resolveBtn!: HTMLButtonElement;
  private resolveRing!: HTMLSpanElement;

  constructor(
    manager: CobManager,
    navManager: CobPanel["navManager"],
    alarm: CobAlarm,
  ) {
    this.manager = manager;
    this.navManager = navManager;
    this.alarm = alarm;

    this.el = document.createElement("div");
    this.el.className = "cob-panel";
    this.build();
    document.body.appendChild(this.el);

    // Any interaction with the panel is a user gesture — use it to unlock
    // audio blocked by autoplay policy after a crash-restore.
    this.el.addEventListener("pointerdown", () => this.alarm.retryUnlock());

    this.manager.subscribe((state) => this.onCobChange(state));
    this.navManager.subscribe(this.onFix);
    this.alarm.onBlockedChange(() => this.renderAudioBlocked());
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    this.el.classList.toggle("collapsed", this.collapsed);
  }

  private build(): void {
    // Header
    const header = document.createElement("div");
    header.className = "cob-panel-header";
    const title = document.createElement("span");
    title.className = "cob-panel-title";
    title.textContent = "CREW OVERBOARD";
    this.elapsedEl = document.createElement("span");
    this.elapsedEl.className = "cob-panel-elapsed";
    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "cob-panel-collapse";
    collapseBtn.setAttribute("aria-label", "Collapse panel");
    collapseBtn.textContent = "—";
    collapseBtn.addEventListener("click", () => this.toggle());
    header.append(title, this.elapsedEl, collapseBtn);

    // Body: coordinates for the mayday call
    const body = document.createElement("div");
    body.className = "cob-panel-body";
    const pos = document.createElement("div");
    pos.className = "cob-panel-pos";
    this.latEl = document.createElement("div");
    this.lonEl = document.createElement("div");
    pos.append(this.latEl, this.lonEl);

    // Nav data row
    const data = document.createElement("div");
    data.className = "cob-panel-data";
    const cell = (label: string): HTMLSpanElement => {
      const wrap = document.createElement("div");
      wrap.className = "cob-panel-cell";
      const lab = document.createElement("div");
      lab.className = "cob-panel-cell-label";
      lab.textContent = label;
      const val = document.createElement("span");
      val.className = "cob-panel-cell-value";
      val.textContent = "--";
      wrap.append(lab, val);
      data.appendChild(wrap);
      return val;
    };
    this.brgEl = cell("BRG");
    this.dstEl = cell("DST");
    this.sogEl = cell("SOG");
    this.cogEl = cell("COG");

    this.warnEl = document.createElement("div");
    this.warnEl.className = "cob-panel-warn";
    this.warnEl.style.display = "none";

    this.audioEl = document.createElement("div");
    this.audioEl.className = "cob-panel-audio-blocked";
    this.audioEl.textContent = "🔇 Tap to enable alarm sound";
    this.audioEl.style.display = "none";

    // Footer actions
    const footer = document.createElement("div");
    footer.className = "cob-panel-actions";

    this.muteBtn = document.createElement("button");
    this.muteBtn.type = "button";
    this.muteBtn.className = "cob-panel-btn";
    this.muteBtn.addEventListener("click", () => {
      const state = this.manager.getState();
      if (state) this.manager.setMuted(!state.muted);
    });

    this.renavBtn = document.createElement("button");
    this.renavBtn.type = "button";
    this.renavBtn.className = "cob-panel-btn cob-panel-btn-renav";
    this.renavBtn.textContent = "Navigate to COB";
    this.renavBtn.addEventListener("click", () => this.manager.renavigate());

    this.resolveBtn = document.createElement("button");
    this.resolveBtn.type = "button";
    this.resolveBtn.className = "cob-panel-btn cob-panel-btn-resolve";
    const resolveLabel = document.createElement("span");
    resolveLabel.textContent = "Recovered — hold to end";
    this.resolveRing = document.createElement("span");
    this.resolveRing.className = "cob-resolve-progress";
    this.resolveBtn.append(this.resolveRing, resolveLabel);
    this.detachResolveHold = attachHoldGesture(this.resolveBtn, {
      holdMs: HOLD_MS,
      stepped: () => getSettings().displayTheme === "eink",
      onProgress: (frac) => {
        this.resolveRing.style.width = `${frac * 100}%`;
      },
      onComplete: () => {
        this.resolveRing.style.width = "0%";
        this.manager.resolve().catch(console.error);
      },
      onCancel: () => {
        this.resolveRing.style.width = "0%";
      },
    });

    footer.append(this.muteBtn, this.renavBtn, this.resolveBtn);
    body.append(pos, data, this.warnEl, this.audioEl, footer);
    this.el.append(header, body);
  }

  private onCobChange(state: CobRuntimeState | null): void {
    if (!state) {
      this.el.classList.remove("open");
      this.stopTicker();
      return;
    }
    // Expand only on the closed→open transition — a mid-event state change
    // (e.g. mute toggle) must not un-collapse a deliberately collapsed panel.
    if (!this.el.classList.contains("open")) {
      this.collapsed = false;
      this.el.classList.remove("collapsed");
      this.el.classList.add("open");
    }
    this.latEl.textContent = formatLatLon(state.waypoint.lat, "lat");
    this.lonEl.textContent = formatLatLon(state.waypoint.lon, "lon");
    this.renderMute(state);
    this.renderTick();
    this.renderNavData();
    this.renderAudioBlocked();
    this.startTicker();
  }

  private readonly onFix = (): void => {
    if (this.manager.isActive()) this.renderNavData();
  };

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.renderTick(), 1000);
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** 1 Hz updates: elapsed time, staleness warning, renav visibility. */
  private renderTick(): void {
    const state = this.manager.getState();
    if (!state) return;
    this.elapsedEl.textContent = formatCobElapsed(Date.now() - state.startedAt);

    const staleNow = this.navManager.isFixStale();
    if (staleNow) {
      this.warnEl.textContent = "NO GPS — data frozen";
      this.warnEl.style.display = "";
    } else if (state.staleAtDrop) {
      this.warnEl.textContent = `Position from stale fix (~${Math.round(state.fixAgeAtDropMs / 1000)}s old at drop)`;
      this.warnEl.style.display = "";
    } else {
      this.warnEl.style.display = "none";
    }

    this.renavBtn.style.display = this.manager.isCobNavigation() ? "none" : "";
  }

  /** Per-fix updates: bearing/distance back to the point, SOG/COG. */
  private renderNavData(): void {
    const state = this.manager.getState();
    if (!state) return;
    const fix = this.navManager.getLastData();
    const settings = getSettings();
    if (!fix || this.navManager.isFixStale()) {
      this.brgEl.textContent = "--";
      this.dstEl.textContent = "--";
      this.sogEl.textContent = "--";
      this.cogEl.textContent = "--";
      return;
    }
    const nav = computeNavigation(
      fix.latitude,
      fix.longitude,
      state.waypoint.lat,
      state.waypoint.lon,
    );
    this.brgEl.textContent = formatBearing(
      nav.bearingDeg,
      settings.bearingMode,
      fix.latitude,
      fix.longitude,
    );
    this.dstEl.textContent = formatDistanceNM(
      nav.distanceNM,
      settings.depthUnit,
    );
    this.sogEl.textContent =
      fix.sog != null
        ? `${convertSpeed(fix.sog, settings.speedUnit).toFixed(1)} ${speedUnitLabel(settings.speedUnit)}`
        : "--";
    this.cogEl.textContent =
      fix.cog != null
        ? `${Math.round(fix.cog).toString().padStart(3, "0")}°`
        : "--";
  }

  private renderMute(state: CobRuntimeState): void {
    this.muteBtn.textContent = state.muted ? "Unmute alarm" : "Mute alarm";
  }

  private renderAudioBlocked(): void {
    this.audioEl.style.display =
      this.manager.isActive() && this.alarm.isBlocked() ? "" : "none";
  }

  dispose(): void {
    this.stopTicker();
    this.detachResolveHold?.();
    this.navManager.unsubscribe(this.onFix);
    this.el.remove();
  }
}
