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

const NAV_INSTRUMENT_IDS = ["dtw", "brg"];

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

  let lastData: NavigationData | null = null;
  let navActive = false;
  let navCellClickCallback: (() => void) | null = null;

  // Persistent cell references — update text instead of rebuilding DOM
  type CellRef = {
    valuEl: HTMLSpanElement;
    unitEl: HTMLSpanElement;
    def: InstrumentDef;
  };
  let baseCells: CellRef[] = [];
  let navCells: CellRef[] = [];
  let navGroup: HTMLDivElement | null = null;

  /** Rebuild DOM structure (only when cell config or nav active state changes). */
  const rebuildStructure = () => {
    container.innerHTML = "";
    baseCells = [];
    navCells = [];
    navGroup = null;
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
      for (let i = 0; i < NAV_INSTRUMENT_IDS.length; i++) {
        const def = INSTRUMENTS.get(NAV_INSTRUMENT_IDS[i]);
        if (!def) continue;
        const { cell, valuEl, unitEl } = buildCell(def, i > 0, lastData, s);
        cell.classList.add("instrument-cell--nav");
        navCells.push({ valuEl, unitEl, def });
        navGroup.appendChild(cell);
      }
      container.appendChild(navGroup);
    }
  };

  /** Update just the text content of existing cells (cheap, no DOM rebuild). */
  const updateValues = () => {
    const s = getSettings();
    for (const c of baseCells) {
      const f = c.def.format(lastData, s);
      c.valuEl.textContent = f.value;
      c.unitEl.textContent = f.unit;
    }
    for (const c of navCells) {
      const f = c.def.format(lastData, s);
      c.valuEl.textContent = f.value;
      c.unitEl.textContent = f.unit;
    }
  };

  navManager.subscribe((data) => {
    lastData = data;
    updateValues();
  });

  const applyVisibility = (s: Settings) => {
    container.style.display = s.showInstrumentHUD ? "flex" : "none";
  };
  applyVisibility(getSettings());
  onSettingsChange((s) => {
    applyVisibility(s);
    rebuildStructure();
  });

  rebuildStructure();

  return {
    element: container,
    onNavCellClick(callback: () => void) {
      navCellClickCallback = callback;
    },
    setActiveNav(activeNav: ActiveNavigationManager) {
      const onNavChange = (_info: unknown, state: ActiveNavigationState) => {
        const active = state.type !== "idle";
        if (active !== navActive) {
          navActive = active;
          rebuildStructure();
        }
      };
      activeNav.subscribe(onNavChange);
      if (activeNav.getState().type !== "idle") {
        navActive = true;
        rebuildStructure();
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

  const label = document.createElement("span");
  label.className = "instrument-label";
  if (def.shortLabel) {
    const full = document.createElement("span");
    full.className = "instrument-label-full";
    full.textContent = def.label;
    const short = document.createElement("span");
    short.className = "instrument-label-short";
    short.textContent = def.shortLabel;
    label.append(full, short);
  } else {
    label.textContent = def.label;
  }

  const valueRow = document.createElement("div");
  valueRow.className = "instrument-value-row";

  const formatted = def.format(data, settings);

  const valuEl = document.createElement("span");
  valuEl.className = "instrument-value";
  valuEl.textContent = formatted.value;

  const unitEl = document.createElement("span");
  unitEl.className = "instrument-unit";
  unitEl.textContent = formatted.unit;

  valueRow.append(valuEl, unitEl);
  cell.append(label, valueRow);
  return { cell, valuEl, unitEl };
}
