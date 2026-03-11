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
import { convertSpeed, speedUnitLabel } from "../utils/units";

export interface InstrumentDef {
  id: string;
  label: string;
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
      label: "Speed",
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
      label: "Heading",
      format(data) {
        if (!data || data.cog === null) return { value: "--", unit: "T" };
        return {
          value: `${data.cog.toFixed(0).padStart(3, "0")}\u00b0`,
          unit: "T",
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

  /** Rebuild all cells from scratch. */
  const rebuild = () => {
    container.innerHTML = "";
    const s = getSettings();
    const baseIds = s.instrumentCells;

    // Base cells
    for (let i = 0; i < baseIds.length; i++) {
      const def = INSTRUMENTS.get(baseIds[i]);
      if (!def) continue;
      container.appendChild(buildCell(def, i > 0, lastData, s));
    }

    // Nav cells (grouped so they wrap together)
    if (navActive) {
      const group = document.createElement("div");
      group.className = "instrument-nav-group";
      group.style.cursor = "pointer";
      group.addEventListener("click", () => {
        if (navCellClickCallback) navCellClickCallback();
      });
      for (let i = 0; i < NAV_INSTRUMENT_IDS.length; i++) {
        const def = INSTRUMENTS.get(NAV_INSTRUMENT_IDS[i]);
        if (!def) continue;
        const cell = buildCell(def, i > 0, lastData, s);
        cell.classList.add("instrument-cell--nav");
        group.appendChild(cell);
      }
      container.appendChild(group);
    }
  };

  navManager.subscribe((data) => {
    lastData = data;
    rebuild();
  });

  const applyVisibility = (s: Settings) => {
    container.style.display = s.showInstrumentHUD ? "flex" : "none";
  };
  applyVisibility(getSettings());
  onSettingsChange((s) => {
    applyVisibility(s);
    rebuild();
  });

  rebuild();

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
          rebuild();
        }
      };
      activeNav.subscribe(onNavChange);
      if (activeNav.getState().type !== "idle") {
        navActive = true;
        rebuild();
      }
    },
  };
}

function buildCell(
  def: InstrumentDef,
  bordered: boolean,
  data: NavigationData | null,
  settings: Settings,
): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "instrument-cell";
  if (bordered) div.classList.add("instrument-cell--bordered");

  const label = document.createElement("span");
  label.className = "instrument-label";
  label.textContent = def.label;

  const valueRow = document.createElement("div");
  valueRow.className = "instrument-value-row";

  const formatted = def.format(data, settings);

  const value = document.createElement("span");
  value.className = "instrument-value";
  value.textContent = formatted.value;

  const unit = document.createElement("span");
  unit.className = "instrument-unit";
  unit.textContent = formatted.unit;

  valueRow.append(value, unit);
  div.append(label, valueRow);
  return div;
}
