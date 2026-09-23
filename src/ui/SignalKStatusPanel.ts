/**
 * Signal K diagnostics: what the boat's server is sending, and whether Pelorus
 * is getting what it navigates from. Answers the field questions a one-line
 * status can't — which instrument feeds the position, whether a value has gone
 * stale, whether the GPS reports its fix quality, what else (depth, wind, AIS)
 * the server offers.
 *
 * While open, the provider also subscribes to every own-vessel path and to
 * other vessels' positions (to count AIS targets); it narrows back on close.
 */

import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { SignalKProvider } from "../navigation/SignalKProvider";
import type {
  SignalKDiagnostics,
  SignalKPathSample,
} from "../navigation/signalk-diagnostics";
import { toDegrees } from "../utils/coordinates";
import { MS_TO_KNOTS } from "../utils/units";
import { hdopQuality } from "./SatelliteStatusPanel";
import { ageTone, formatAge, formatSignalkValue } from "./signalk-format";
import {
  addStatusRow,
  type DotState,
  type StatusRow,
  setStatusRow,
  setStatusRowVisible,
} from "./status-grid";

const POLL_MS = 1000;
const GNSS_PREFIX = "navigation.gnss.";

interface DataRow {
  el: HTMLElement;
  value: HTMLElement;
  meta: HTMLElement;
}

const degreesText = (rad: unknown): string =>
  typeof rad === "number" ? `${Math.round(toDegrees(rad))}°` : "—";

export class SignalKStatusPanel {
  private readonly overlay: HTMLDivElement;
  private readonly rowServer: StatusRow;
  private readonly rowVessel: StatusRow;
  private readonly rowAddress: StatusRow;
  private readonly rowLink: StatusRow;
  private readonly rowTraffic: StatusRow;
  private readonly rowPosition: StatusRow;
  private readonly rowCog: StatusRow;
  private readonly rowSog: StatusRow;
  private readonly rowHeading: StatusRow;
  private readonly gnssSection: HTMLElement;
  private readonly rowFix: StatusRow;
  private readonly rowSats: StatusRow;
  private readonly rowHdop: StatusRow;
  private readonly rowInView: StatusRow;
  private readonly dataHeader: HTMLDivElement;
  private readonly aisLine: HTMLDivElement;
  private readonly dataList: HTMLDivElement;
  private readonly reconnectBtn: HTMLButtonElement;
  // Persistent list rows keyed by path, updated in place (no DOM churn).
  private readonly dataRows = new Map<string, DataRow>();

  private visible = false;
  private provider: SignalKProvider | null = null;
  private manager: NavigationDataManager | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "about-overlay";

    const card = document.createElement("div");
    card.className = "about-card sk-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "Signal K Diagnostics";

    const serverGrid = document.createElement("div");
    serverGrid.className = "sat-status";
    this.rowServer = addStatusRow(serverGrid, "Server");
    this.rowVessel = addStatusRow(serverGrid, "Vessel");
    this.rowAddress = addStatusRow(serverGrid, "Address");
    this.rowLink = addStatusRow(serverGrid, "Link");
    this.rowTraffic = addStatusRow(serverGrid, "Traffic");

    const usedGrid = document.createElement("div");
    usedGrid.className = "sat-status";
    this.rowPosition = addStatusRow(usedGrid, "Position");
    this.rowCog = addStatusRow(usedGrid, "COG");
    this.rowSog = addStatusRow(usedGrid, "SOG");
    this.rowHeading = addStatusRow(usedGrid, "Heading");

    const gnssGrid = document.createElement("div");
    gnssGrid.className = "sat-status";
    this.rowFix = addStatusRow(gnssGrid, "Fix");
    this.rowSats = addStatusRow(gnssGrid, "Satellites");
    this.rowHdop = addStatusRow(gnssGrid, "HDOP");
    this.rowInView = addStatusRow(gnssGrid, "In view");
    this.gnssSection = document.createElement("div");
    this.gnssSection.append(sectionHeader("GPS quality"), gnssGrid);

    // Descriptive rows carry no traffic-light state.
    for (const r of [
      this.rowServer,
      this.rowVessel,
      this.rowAddress,
      this.rowTraffic,
      this.rowFix,
      this.rowSats,
      this.rowHdop,
      this.rowInView,
    ]) {
      r.dot.style.display = "none";
    }

    this.reconnectBtn = document.createElement("button");
    this.reconnectBtn.className = "sat-inline-btn";
    this.reconnectBtn.type = "button";
    this.reconnectBtn.textContent = "Reconnect";
    this.reconnectBtn.addEventListener("click", () =>
      this.manager?.reconnectActiveProvider(),
    );
    this.rowLink.action.appendChild(this.reconnectBtn);

    this.dataHeader = sectionHeader("");
    this.aisLine = document.createElement("div");
    this.aisLine.className = "sk-ais";
    this.dataList = document.createElement("div");
    this.dataList.className = "sk-data-list";
    const unitsNote = document.createElement("div");
    unitsNote.className = "sk-note";
    unitsNote.textContent =
      "Values as the server sends them, in SI units (m, m/s, rad, K, Pa).";

    const closeBtn = document.createElement("button");
    closeBtn.className = "about-clear-cache";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.hide());

    card.append(
      title,
      serverGrid,
      sectionHeader("Used by Pelorus"),
      usedGrid,
      this.gnssSection,
      this.dataHeader,
      this.aisLine,
      this.dataList,
      unitsNote,
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

  show(provider: SignalKProvider, manager: NavigationDataManager): void {
    if (this.visible) return;
    this.visible = true;
    this.provider = provider;
    this.manager = manager;
    provider.setInspecting(true);
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
    this.provider?.setInspecting(false);
    this.provider = null;
    this.manager = null;
  }

  private refresh(): void {
    const provider = this.provider;
    if (!provider) return;
    const d = provider.diagnostics;
    const now = Date.now();
    const connected = provider.isConnected();

    this.refreshServer(provider, d, connected, now);

    const sample = (path: string) =>
      connected ? d.paths.get(path) : undefined;
    this.setSample(this.rowPosition, sample("navigation.position"), now, "red");
    this.setSample(
      this.rowCog,
      sample("navigation.courseOverGroundTrue"),
      now,
      "amber",
      (v) => `${degreesText(v)} T`,
    );
    this.setSample(
      this.rowSog,
      sample("navigation.speedOverGround"),
      now,
      "amber",
      (v) =>
        typeof v === "number" ? `${(v * MS_TO_KNOTS).toFixed(1)} kn` : "—",
    );
    const magnetic = sample("navigation.headingMagnetic");
    if (sample("navigation.headingTrue") || !magnetic) {
      this.setSample(
        this.rowHeading,
        sample("navigation.headingTrue"),
        now,
        "amber",
        (v) => `${degreesText(v)} T`,
      );
    } else {
      // Magnetic compass only: show what Pelorus makes of it.
      const variationFrom = sample("navigation.magneticVariation")
        ? "server variation"
        : "charted variation";
      const heading = this.manager?.getLastData()?.heading;
      const trueText =
        heading !== null && heading !== undefined
          ? `${Math.round(heading)}° T`
          : "—";
      this.setSample(
        this.rowHeading,
        magnetic,
        now,
        "amber",
        (v) => `${degreesText(v)} M → ${trueText} (${variationFrom})`,
      );
    }

    this.refreshGnss(d, connected, now);
    this.refreshData(d, connected, now);
  }

  private refreshServer(
    provider: SignalKProvider,
    d: SignalKDiagnostics,
    connected: boolean,
    now: number,
  ): void {
    const { name, version } = d.hello;
    setStatusRow(
      this.rowServer,
      "off",
      connected && name ? [name, version].filter(Boolean).join(" ") : "—",
    );

    const vessel = connected ? d.paths.get("")?.value : undefined;
    const { name: boat, mmsi } = (vessel ?? {}) as Record<string, unknown>;
    const vesselText = [
      typeof boat === "string" ? boat : null,
      typeof mmsi === "string" ? `MMSI ${mmsi}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    setStatusRowVisible(this.rowVessel, vesselText !== "");
    setStatusRow(this.rowVessel, "off", vesselText);

    const url = provider.streamUrl;
    setStatusRow(this.rowAddress, "off", url ?? "No server entered");

    if (connected) {
      setStatusRow(
        this.rowLink,
        "green",
        `Connected · ${formatAge(now - d.connectedAtMs)}`,
      );
    } else if (provider.isReconnecting()) {
      setStatusRow(this.rowLink, "amber", "Can't reach the server — retrying");
    } else {
      setStatusRow(this.rowLink, "red", "Not connected");
    }
    this.reconnectBtn.style.display = connected || !url ? "none" : "";

    const drops = Math.max(0, d.connections - 1);
    setStatusRow(
      this.rowTraffic,
      "off",
      connected
        ? `${d.messageRate(now).toFixed(1)} msg/s${drops ? ` · reconnected ${drops}×` : ""}`
        : "—",
    );
  }

  private refreshGnss(
    d: SignalKDiagnostics,
    connected: boolean,
    now: number,
  ): void {
    const gnss = (key: string) =>
      connected ? d.paths.get(GNSS_PREFIX + key) : undefined;
    const any =
      connected && [...d.paths.keys()].some((p) => p.startsWith(GNSS_PREFIX));
    this.gnssSection.style.display = any ? "" : "none";
    if (!any) return;
    this.setSample(this.rowFix, gnss("methodQuality"), now, "off");
    this.setSample(this.rowSats, gnss("satellites"), now, "off", (v) =>
      typeof v === "number" ? `${v} used` : "—",
    );
    this.setSample(this.rowHdop, gnss("horizontalDilution"), now, "off", (v) =>
      typeof v === "number" ? `${v.toFixed(1)} · ${hdopQuality(v)}` : "—",
    );
    this.setSample(
      this.rowInView,
      gnss("satellitesInView"),
      now,
      "off",
      (v) => {
        const count = (v as { count?: unknown } | null)?.count;
        return typeof count === "number" ? `${count}` : "—";
      },
    );
  }

  private refreshData(
    d: SignalKDiagnostics,
    connected: boolean,
    now: number,
  ): void {
    const paths = connected
      ? [...d.paths.keys()].filter((p) => p !== "").sort()
      : [];
    this.dataHeader.textContent = `All data from this server · ${paths.length}`;
    const ais = connected ? d.otherVesselCount(now) : 0;
    this.aisLine.textContent = `Other vessels (AIS): ${ais}`;

    for (const path of paths) {
      const s = d.paths.get(path) as SignalKPathSample;
      let row = this.dataRows.get(path);
      if (!row) {
        row = buildDataRow(path);
        this.dataRows.set(path, row);
      }
      setText(row.value, formatSignalkValue(s.value));
      setText(
        row.meta,
        [formatAge(now - s.receivedMs), s.source].filter(Boolean).join(" · "),
      );
      this.dataList.appendChild(row.el); // sorted order; no-op when in place
    }
    const current = new Set(paths);
    for (const [path, row] of this.dataRows) {
      if (!current.has(path)) {
        row.el.remove();
        this.dataRows.delete(path);
      }
    }
  }

  /**
   * One value row: its text (formatted), age and source, with a dot showing
   * freshness. `missing` is the dot when the server doesn't send it at all.
   */
  private setSample(
    row: StatusRow,
    s: SignalKPathSample | undefined,
    now: number,
    missing: DotState,
    format: (value: unknown) => string = formatSignalkValue,
  ): void {
    if (!s) {
      setStatusRow(row, missing, "Not sent by the server");
      return;
    }
    const age = now - s.receivedMs;
    const text = [format(s.value), formatAge(age), s.source]
      .filter(Boolean)
      .join(" · ");
    setStatusRow(row, missing === "off" ? "off" : ageTone(age), text);
  }
}

function sectionHeader(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "sat-sec-header";
  el.textContent = text;
  return el;
}

function buildDataRow(path: string): DataRow {
  const el = document.createElement("div");
  el.className = "sk-data-row";
  const name = document.createElement("div");
  name.className = "sk-data-path";
  name.textContent = path;
  const value = document.createElement("span");
  value.className = "sk-data-value";
  const meta = document.createElement("span");
  meta.className = "sk-data-meta";
  const line = document.createElement("div");
  line.append(value, meta);
  el.append(name, line);
  return { el, value, meta };
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
