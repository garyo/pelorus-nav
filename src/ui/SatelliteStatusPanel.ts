/**
 * GPS diagnostics dashboard for the BLE pod. Shows the whole pipeline so a
 * failure at any stage is obvious at a glance: which source, link state, whether
 * data is arriving, fix type, accuracy (sats + HDOP), position/motion, and live
 * per-satellite signal bars.
 *
 * Opened from Settings; while open it asks the provider to stream GSV/GSA, and
 * stops on close so the chatty traffic only flows when someone's looking. The
 * pod auto-reverts that stream after a timeout to save power — when the stream
 * goes quiet the Data row offers a Resume button to re-arm it.
 */

import type {
  NavigationDataProvider,
  SatelliteDiagnostics,
  SatelliteStatus,
} from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { formatLatLon } from "../utils/coordinates";

// Typical C/N0 ceiling for scaling the bars — strong sats sit around 45-50 dB-Hz.
const SNR_MAX = 55;
// How often to refresh link/data/fix freshness, independent of GSV bursts.
const POLL_MS = 250;
// Satellite data is "live" if a burst arrived within this long; past it (while
// still connected) the pod has timed out the stream and we offer Resume.
const SAT_LIVE_MS = 3000;
// Grace after opening before "Waiting…" becomes "No data — tap Resume", so a
// SAT command that never produces data is recoverable rather than a dead end.
const SAT_OPEN_GRACE_MS = 6000;
// Within the grace window, re-arm this often if no data has arrived — the first
// BLE write after connecting can be dropped, so the initial command self-heals.
const SAT_RETRY_MS = 2000;

const FIX_LABELS: Record<number, string> = {
  1: "No fix — searching",
  2: "2D fix",
  3: "3D fix",
};

// Short constellation codes for the in-view breakdown line.
const CONSTELLATION_SHORT: Record<string, string> = {
  GPS: "GPS",
  GLONASS: "GLO",
  Galileo: "GAL",
  BeiDou: "BDS",
  QZSS: "QZS",
  NavIC: "NAV",
  GNSS: "GNSS",
};

type DotState = "green" | "amber" | "red" | "off";

/** Plain-language quality from HDOP (geometry-driven horizontal accuracy). */
function hdopQuality(hdop: number | null): string {
  if (hdop === null) return "";
  if (hdop <= 1) return "Ideal";
  if (hdop <= 2) return "Excellent";
  if (hdop <= 5) return "Good";
  if (hdop <= 10) return "Moderate";
  if (hdop <= 20) return "Fair";
  return "Poor";
}

interface StatusRow {
  dot: HTMLElement;
  text: HTMLElement;
  action: HTMLElement;
}

interface SatBar {
  row: HTMLElement;
  fill: HTMLElement;
  value: HTMLElement;
}

export class SatelliteStatusPanel {
  private readonly overlay: HTMLDivElement;
  private readonly rowSource: StatusRow;
  private readonly rowLink: StatusRow;
  private readonly rowData: StatusRow;
  private readonly rowFix: StatusRow;
  private readonly rowAccuracy: StatusRow;
  private readonly rowPosition: StatusRow;
  private readonly rowMotion: StatusRow;
  private readonly reconnectBtn: HTMLButtonElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly satHeader: HTMLDivElement;
  private readonly constellations: HTMLDivElement;
  private readonly bars: HTMLDivElement;

  private visible = false;
  private provider: (NavigationDataProvider & SatelliteDiagnostics) | null =
    null;
  private manager: NavigationDataManager | null = null;
  private status: SatelliteStatus | null = null;
  private lastSatDataMs = 0;
  private openedAtMs = 0;
  private lastSatCmdMs = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  // Persistent bar rows keyed by satellite, updated in place (no DOM churn).
  private readonly satRows = new Map<string, SatBar>();

  private readonly onStatus = (status: SatelliteStatus): void => {
    this.status = status;
    this.lastSatDataMs = Date.now();
    this.refresh();
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.renderBars();
      });
    }
  };

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "about-overlay";

    const card = document.createElement("div");
    card.className = "about-card sat-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "GPS Diagnostics";

    const grid = document.createElement("div");
    grid.className = "sat-status";

    this.rowSource = this.addRow(grid, "Source");
    this.rowLink = this.addRow(grid, "Link");
    this.rowData = this.addRow(grid, "Data");
    this.rowFix = this.addRow(grid, "Fix");
    this.rowAccuracy = this.addRow(grid, "Accuracy");
    this.rowPosition = this.addRow(grid, "Position");
    this.rowMotion = this.addRow(grid, "Motion");

    // Source/Accuracy/Position/Motion carry no traffic-light state.
    for (const r of [
      this.rowSource,
      this.rowAccuracy,
      this.rowPosition,
      this.rowMotion,
    ]) {
      r.dot.style.display = "none";
    }

    this.reconnectBtn = this.makeInlineButton("Reconnect", () => {
      this.manager?.reconnectActiveProvider();
    });
    this.resumeBtn = this.makeInlineButton("Resume", () => this.sendSatOn());
    this.rowLink.action.appendChild(this.reconnectBtn);
    this.rowData.action.appendChild(this.resumeBtn);

    this.satHeader = document.createElement("div");
    this.satHeader.className = "sat-sec-header";
    this.constellations = document.createElement("div");
    this.constellations.className = "sat-constellations";
    this.bars = document.createElement("div");
    this.bars.className = "sat-bars";

    const closeBtn = document.createElement("button");
    closeBtn.className = "about-clear-cache";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.hide());

    card.append(
      title,
      grid,
      this.satHeader,
      this.constellations,
      this.bars,
      closeBtn,
    );
    this.overlay.appendChild(card);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.visible) {
        e.preventDefault(); // consumed — the global Escape fallback must not also act
        this.hide();
      }
    });
  }

  /** Open against the active provider + manager and start streaming GSV/GSA. */
  show(
    provider: NavigationDataProvider & SatelliteDiagnostics,
    manager: NavigationDataManager,
  ): void {
    if (this.visible) return;
    this.visible = true;
    this.provider = provider;
    this.manager = manager;
    this.status = null;
    this.lastSatDataMs = 0;
    this.openedAtMs = Date.now();
    this.satRows.clear();
    this.bars.replaceChildren();
    this.satHeader.textContent = "Satellites";
    this.constellations.textContent = "";
    provider.subscribeSatelliteStatus(this.onStatus);
    this.sendSatOn();
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
    this.overlay.style.display = "flex";
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = "none";
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.provider?.requestSatelliteData(false);
    this.provider?.unsubscribeSatelliteStatus(this.onStatus);
    this.provider = null;
    this.manager = null;
  }

  // --- Status rows -------------------------------------------------------

  // Arm satellite forwarding and remember when, so refresh() can re-arm if a
  // dropped initial command leaves us with no data.
  private sendSatOn(): void {
    this.provider?.requestSatelliteData(true);
    this.lastSatCmdMs = Date.now();
  }

  private refresh(): void {
    const provider = this.provider;
    if (!provider) return;

    const connected = provider.isConnected();
    const reconnecting = provider.isReconnecting?.() ?? false;
    const satAge = this.lastSatDataMs
      ? Date.now() - this.lastSatDataMs
      : Infinity;
    const satLive = connected && satAge < SAT_LIVE_MS;
    const hadData = this.lastSatDataMs > 0;
    const pastGrace = Date.now() - this.openedAtMs > SAT_OPEN_GRACE_MS;
    // Offer Resume whenever connected but not streaming, once it's clearly not
    // just initial latency — covers both the pod's auto-revert and a SAT command
    // that produced nothing.
    const offerResume = connected && !satLive && (hadData || pastGrace);

    // Self-heal a dropped initial SAT command: re-arm a few times during the
    // grace window before falling back to the manual Resume. Initial acquisition
    // only — a real post-data timeout still waits for the manual button.
    if (
      connected &&
      !hadData &&
      !pastGrace &&
      Date.now() - this.lastSatCmdMs > SAT_RETRY_MS
    ) {
      this.sendSatOn();
    }

    this.set(this.rowSource, "off", provider.name);

    if (connected) {
      this.set(this.rowLink, "green", "Connected");
    } else if (reconnecting) {
      this.set(this.rowLink, "amber", "Reconnecting…");
    } else {
      this.set(this.rowLink, "red", "Disconnected");
    }
    this.reconnectBtn.style.display = connected ? "none" : "";

    if (!connected) {
      this.set(this.rowData, "off", "—");
    } else if (satLive) {
      this.set(
        this.rowData,
        "green",
        `Live · ${(satAge / 1000).toFixed(1)}s ago`,
      );
    } else if (hadData) {
      this.set(this.rowData, "amber", "Paused — device timeout");
    } else if (pastGrace) {
      this.set(this.rowData, "amber", "No data — tap Resume");
    } else {
      this.set(this.rowData, "amber", "Waiting for data…");
    }
    this.resumeBtn.style.display = offerResume ? "" : "none";

    const status = this.status;
    if (status) {
      const fixState: DotState =
        status.fixType >= 3 ? "green" : status.fixType === 2 ? "amber" : "red";
      this.set(this.rowFix, fixState, FIX_LABELS[status.fixType] ?? "—");
      const hdop = status.hdop !== null ? status.hdop.toFixed(1) : "—";
      const quality = hdopQuality(status.hdop);
      this.set(
        this.rowAccuracy,
        "off",
        `${status.used} used · HDOP ${hdop}${quality ? ` · ${quality}` : ""}`,
      );
    } else {
      this.set(this.rowFix, "off", "—");
      this.set(this.rowAccuracy, "off", "—");
    }

    const data = this.manager?.getLastData() ?? null;
    if (data) {
      this.set(
        this.rowPosition,
        "off",
        `${formatLatLon(data.latitude, "lat")}  ${formatLatLon(data.longitude, "lon")}`,
      );
      const sog = data.sog !== null ? `${data.sog.toFixed(1)} kn` : "— kn";
      const cog =
        data.cog !== null
          ? `COG ${Math.round(data.cog).toString().padStart(3, "0")}°`
          : "COG —";
      this.set(this.rowMotion, "off", `${sog} · ${cog}`);
    } else {
      this.set(this.rowPosition, "off", "—");
      this.set(this.rowMotion, "off", "—");
    }
  }

  private addRow(grid: HTMLElement, label: string): StatusRow {
    const labelEl = document.createElement("div");
    labelEl.className = "sat-status-label";
    labelEl.textContent = label;

    const value = document.createElement("div");
    value.className = "sat-status-value";
    const dot = document.createElement("span");
    dot.className = "sat-dot";
    const text = document.createElement("span");
    value.append(dot, text);

    const action = document.createElement("div");
    action.className = "sat-status-action";

    grid.append(labelEl, value, action);
    return { dot, text, action };
  }

  private makeInlineButton(
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "sat-inline-btn";
    btn.type = "button";
    btn.textContent = label;
    btn.style.display = "none";
    btn.addEventListener("click", onClick);
    return btn;
  }

  private set(row: StatusRow, dot: DotState, text: string): void {
    row.dot.className = dot === "off" ? "sat-dot" : `sat-dot sat-dot-${dot}`;
    row.text.textContent = text;
  }

  // --- Satellite bars ----------------------------------------------------

  private renderBars(): void {
    const status = this.status;
    if (!status) return;

    this.satHeader.textContent = `Satellites · ${status.inView} in view`;
    this.constellations.textContent = this.constellationBreakdown(status);

    // Stable order so rows don't dance as SNRs fluctuate: by constellation, PRN.
    const sats = [...status.satellites].sort((a, b) =>
      a.constellation === b.constellation
        ? a.prn - b.prn
        : a.constellation.localeCompare(b.constellation),
    );

    const seen = new Set<string>();
    for (const sat of sats) {
      const key = `${sat.constellation} ${sat.prn}`;
      seen.add(key);
      let r = this.satRows.get(key);
      if (!r) {
        r = this.buildBar(key);
        this.satRows.set(key, r);
      }
      r.row.className = sat.used ? "sat-row sat-row-used" : "sat-row";
      const snr = sat.snr ?? 0;
      r.fill.style.width = `${Math.min(100, (snr / SNR_MAX) * 100)}%`;
      r.value.textContent = sat.snr !== null ? `${sat.snr}` : "—";
      this.bars.appendChild(r.row); // re-append in sorted order; no-op if in place
    }

    for (const [key, r] of this.satRows) {
      if (!seen.has(key)) {
        r.row.remove();
        this.satRows.delete(key);
      }
    }
  }

  private constellationBreakdown(status: SatelliteStatus): string {
    const counts = new Map<string, number>();
    for (const s of status.satellites) {
      const code = CONSTELLATION_SHORT[s.constellation] ?? s.constellation;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts.entries()].map(([c, n]) => `${c} ${n}`).join(" · ");
  }

  private buildBar(key: string): SatBar {
    const row = document.createElement("div");
    row.className = "sat-row";

    const label = document.createElement("span");
    label.className = "sat-label";
    label.textContent = key;

    const track = document.createElement("div");
    track.className = "sat-track";
    const fill = document.createElement("div");
    fill.className = "sat-fill";
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "sat-value";

    row.append(label, track, value);
    return { row, fill, value };
  }
}
