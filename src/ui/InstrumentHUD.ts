/**
 * Instrument HUD: large, high-visibility data display at top of screen.
 * Shows SOG and COG (or other instruments) in big readable text.
 * When active navigation is running, DTW and BRG cells are appended.
 */

import type {
  ActiveNavigationManager,
  ActiveNavigationState,
} from "../navigation/ActiveNavigation";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { Settings } from "../settings";
import { getSettings, onSettingsChange } from "../settings";
import { applyDeclination, bearingModeLabel } from "../utils/magnetic";
import { convertSpeed, speedUnitLabel } from "../utils/units";

export interface InstrumentDef {
  id: string;
  label: string;
  shortLabel?: string;
  /** Extra CSS class added to the cell (e.g. for smaller text on string-valued cells). */
  cellClass?: string;
  format(
    data: NavigationData | null,
    settings: Settings,
  ): { value: string; unit: string };
}

export const INSTRUMENTS: Map<string, InstrumentDef> = new Map([
  [
    "sog",
    {
      id: "sog",
      label: "Speed over Ground",
      shortLabel: "SOG",
      format(data, settings) {
        if (!data || data.sog === null) {
          return { value: "--", unit: speedUnitLabel(settings.speedUnit) };
        }
        return {
          value: convertSpeed(data.sog, settings.speedUnit).toFixed(1),
          unit: speedUnitLabel(settings.speedUnit),
        };
      },
    },
  ],
  [
    "cog",
    {
      id: "cog",
      label: "Course over Ground",
      shortLabel: "COG",
      format(data, settings) {
        const mode = settings.bearingMode;
        const label = bearingModeLabel(mode);
        if (!data || data.cog === null) return { value: "--", unit: label };
        const display = applyDeclination(
          data.cog,
          mode,
          data.latitude,
          data.longitude,
        );
        return {
          value: `${Math.round(display).toString().padStart(3, "0")}\u00b0`,
          unit: label,
        };
      },
    },
  ],
]);

const NAV_INSTRUMENT_IDS = ["dtw", "brg", "vmg", "steer"];

export interface InstrumentHUDHandle {
  element: HTMLElement;
  setActiveNav(activeNav: ActiveNavigationManager): void;
  /** Register a callback invoked when user clicks a nav instrument cell (DTW/BRG). */
  onNavCellClick(callback: () => void): void;
}

export function createInstrumentHUD(
  navManager: NavigationDataManager,
): InstrumentHUDHandle {
  const container = document.createElement("div");
  container.className = "instrument-hud";

  // GPS status badge (corner): a dot that pings on each fix, flips to a clear
  // "NO GPS" state when fixes stop arriving (signal loss). Lives in the corner
  // of the instrument panel so it's visible on every theme, e-ink included.
  const gpsBadge = document.createElement("div");
  gpsBadge.className = "instrument-gps";
  const gpsDot = document.createElement("span");
  gpsDot.className = "instrument-gps-dot";
  const gpsText = document.createElement("span");
  gpsText.className = "instrument-gps-text";
  gpsBadge.append(gpsDot, gpsText);

  let lastData: NavigationData | null = null;
  let navActive = false;
  let navCellClickCallback: (() => void) | null = null;

  const updateGpsStatus = (stale: boolean) => {
    gpsBadge.dataset.conn = stale ? "bad" : "ok";
    gpsDot.textContent = stale ? "✕" : "●"; // ✕ / ●
    gpsText.textContent = stale ? "NO GPS" : "GPS";
  };

  /** Brief pulse on the dot for each received fix — a live "fix" cue. */
  const pingFix = () => {
    gpsDot.classList.remove("instrument-gps-ping");
    void gpsDot.offsetWidth; // restart the animation
    gpsDot.classList.add("instrument-gps-ping");
  };

  // Persistent cell references — update text instead of rebuilding DOM
  type CellRef = {
    valuEl: HTMLSpanElement;
    unitEl: HTMLSpanElement;
    def: InstrumentDef;
  };
  let baseCells: CellRef[] = [];
  let navCells: CellRef[] = [];
  let navGroup: HTMLDivElement | null = null;
  let nextWpEl: HTMLDivElement | null = null;
  let activeNavRef: ActiveNavigationManager | null = null;

  /** Rebuild DOM structure (only when cell config or nav active state changes). */
  const rebuildStructure = () => {
    container.innerHTML = "";
    baseCells = [];
    navCells = [];
    navGroup = null;
    nextWpEl = null;
    const s = getSettings();
    const baseIds = s.instrumentCells;

    for (let i = 0; i < baseIds.length; i++) {
      const def = INSTRUMENTS.get(baseIds[i]);
      if (!def) continue;
      const { cell, valuEl, unitEl } = buildCell(def, i > 0, lastData, s);
      baseCells.push({ valuEl, unitEl, def });
      container.appendChild(cell);
    }

    if (navActive) {
      navGroup = document.createElement("div");
      navGroup.className = "instrument-nav-group";
      navGroup.style.cursor = "pointer";
      navGroup.addEventListener("click", () => {
        if (navCellClickCallback) navCellClickCallback();
      });
      // Full-width caption for the upcoming waypoint — text-only, hidden
      // when there is no next waypoint (final leg or goto mode).
      nextWpEl = document.createElement("div");
      nextWpEl.className = "instrument-next-wp";
      navGroup.appendChild(nextWpEl);
      // Row containing DTW / BRG / VMG / STEER. Sized smaller than the
      // primary SOG/COG row.
      const navRow = document.createElement("div");
      navRow.className = "instrument-nav-row";
      for (let i = 0; i < NAV_INSTRUMENT_IDS.length; i++) {
        const def = INSTRUMENTS.get(NAV_INSTRUMENT_IDS[i]);
        if (!def) continue;
        const { cell, valuEl, unitEl } = buildCell(def, i > 0, lastData, s);
        cell.classList.add("instrument-cell--nav");
        navCells.push({ valuEl, unitEl, def });
        navRow.appendChild(cell);
      }
      navGroup.appendChild(navRow);
      container.appendChild(navGroup);
    }
    // Re-attach the GPS badge (innerHTML reset above removed it) and refresh
    // the freshly-built cells for the current freshness state.
    container.appendChild(gpsBadge);
    updateGpsStatus(navManager.isFixStale());
    updateValues();
  };

  /** Update just the text content of existing cells (cheap, no DOM rebuild). */
  const updateValues = () => {
    const s = getSettings();
    // On GPS signal loss, fixes stop arriving and the last one would otherwise
    // linger forever (e.g. frozen at 40 kn in a tunnel). Treat a stale fix as
    // no data so every motion/nav cell reads "--".
    const data = navManager.isFixStale() ? null : lastData;
    for (const c of baseCells) {
      const f = c.def.format(data, s);
      c.valuEl.textContent = f.value;
      c.unitEl.textContent = f.unit;
    }
    for (const c of navCells) {
      const f = c.def.format(data, s);
      c.valuEl.textContent = f.value;
      c.unitEl.textContent = f.unit;
    }
    if (nextWpEl) {
      const name = activeNavRef?.getInfo()?.nextWaypointName ?? null;
      if (name) {
        nextWpEl.textContent = `Next: ${name}`;
        nextWpEl.style.display = "";
      } else {
        nextWpEl.textContent = "";
        nextWpEl.style.display = "none";
      }
    }
  };

  navManager.subscribe((data) => {
    lastData = data;
    updateValues();
    updateGpsStatus(false);
    pingFix();
  });

  // Re-evaluate freshness even when no fixes arrive, so a dropped link flips
  // the badge to "NO GPS" and blanks the motion cells rather than freezing.
  window.setInterval(() => {
    const stale = navManager.isFixStale();
    updateGpsStatus(stale);
    if (stale) updateValues();
  }, 1000);

  const applyVisibility = (s: Settings) => {
    container.style.display = s.showInstrumentHUD ? "flex" : "none";
  };
  applyVisibility(getSettings());

  // Only `instrumentCells` changes which cells exist — everything else
  // (units, bearing mode, etc.) just changes formatted text, handled by
  // updateValues(). Settings commit ~8×/s during slider drags, so a full
  // rebuild must be reserved for actual structure changes.
  let lastInstrumentCells = getSettings().instrumentCells;
  const instrumentCellsChanged = (cells: readonly string[]): boolean =>
    cells.length !== lastInstrumentCells.length ||
    cells.some((id, i) => id !== lastInstrumentCells[i]);

  onSettingsChange((s) => {
    applyVisibility(s);
    if (instrumentCellsChanged(s.instrumentCells)) {
      lastInstrumentCells = s.instrumentCells;
      rebuildStructure();
    } else {
      updateValues();
    }
  });

  rebuildStructure();

  return {
    element: container,
    onNavCellClick(callback: () => void) {
      navCellClickCallback = callback;
    },
    setActiveNav(activeNav: ActiveNavigationManager) {
      activeNavRef = activeNav;
      const onNavChange = (_info: unknown, state: ActiveNavigationState) => {
        const active = state.type !== "idle";
        if (active !== navActive) {
          navActive = active;
          rebuildStructure();
        }
        // Refresh the next-wp caption even when active didn't change
        // (e.g. advancing legs within an active route).
        updateValues();
      };
      activeNav.subscribe(onNavChange);
      if (activeNav.getState().type !== "idle") {
        navActive = true;
        rebuildStructure();
        updateValues();
      }
    },
  };
}

function buildCell(
  def: InstrumentDef,
  bordered: boolean,
  data: NavigationData | null,
  settings: Settings,
): { cell: HTMLDivElement; valuEl: HTMLSpanElement; unitEl: HTMLSpanElement } {
  const cell = document.createElement("div");
  cell.className = "instrument-cell";
  if (bordered) cell.classList.add("instrument-cell--bordered");
  if (def.cellClass) cell.classList.add(def.cellClass);

  const label = document.createElement("span");
  label.className = "instrument-label";
  label.title = def.label;
  label.textContent = def.shortLabel ?? def.label;

  const valueRow = document.createElement("div");
  valueRow.className = "instrument-value-row";

  const formatted = def.format(data, settings);

  const valuEl = document.createElement("span");
  valuEl.className = "instrument-value";
  valuEl.textContent = formatted.value;

  const unitEl = document.createElement("span");
  unitEl.className = "instrument-unit";
  unitEl.textContent = formatted.unit;

  // Meta column to the right of the digits: label on top, unit on bottom.
  const meta = document.createElement("div");
  meta.className = "instrument-meta";
  meta.append(label, unitEl);

  valueRow.append(valuEl, meta);
  cell.append(valueRow);
  return { cell, valuEl, unitEl };
}
