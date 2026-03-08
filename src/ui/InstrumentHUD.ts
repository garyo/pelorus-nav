/**
 * Instrument HUD: large, high-visibility data display at top of screen.
 * Shows SOG and COG (or other instruments) in big readable text.
 */

import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { Settings, SpeedUnit } from "../settings";
import { getSettings, onSettingsChange } from "../settings";

export interface InstrumentDef {
  id: string;
  label: string;
  format(
    data: NavigationData | null,
    settings: Settings,
  ): { value: string; unit: string };
}

function speedUnitLabel(unit: SpeedUnit): string {
  switch (unit) {
    case "mph":
      return "mph";
    case "kph":
      return "km/h";
    default:
      return "Kt";
  }
}

function convertSpeed(knots: number, unit: SpeedUnit): number {
  switch (unit) {
    case "mph":
      return knots * 1.15078;
    case "kph":
      return knots * 1.852;
    default:
      return knots;
  }
}

const sogInstrument: InstrumentDef = {
  id: "sog",
  label: "Speed",
  format(data, settings) {
    if (!data || data.sog === null) {
      return { value: "--", unit: speedUnitLabel(settings.speedUnit) };
    }
    const converted = convertSpeed(data.sog, settings.speedUnit);
    return {
      value: converted.toFixed(1),
      unit: speedUnitLabel(settings.speedUnit),
    };
  },
};

const cogInstrument: InstrumentDef = {
  id: "cog",
  label: "Heading",
  format(data) {
    if (!data || data.cog === null) {
      return { value: "--", unit: "T" };
    }
    return {
      value: `${data.cog.toFixed(0).padStart(3, "0")}\u00b0`,
      unit: "T",
    };
  },
};

export const INSTRUMENTS: Map<string, InstrumentDef> = new Map([
  ["sog", sogInstrument],
  ["cog", cogInstrument],
]);

export function createInstrumentHUD(
  navManager: NavigationDataManager,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "instrument-hud";

  const settings = getSettings();
  const cellIds = settings.instrumentCells;

  interface CellElements {
    label: HTMLSpanElement;
    value: HTMLSpanElement;
    unit: HTMLSpanElement;
  }

  const cells: CellElements[] = cellIds.map((id, index) => {
    const cellDiv = document.createElement("div");
    cellDiv.className = "instrument-cell";
    if (index > 0) {
      cellDiv.classList.add("instrument-cell--bordered");
    }

    const label = document.createElement("span");
    label.className = "instrument-label";

    const valueRow = document.createElement("div");
    valueRow.className = "instrument-value-row";

    const value = document.createElement("span");
    value.className = "instrument-value";

    const unit = document.createElement("span");
    unit.className = "instrument-unit";

    valueRow.append(value, unit);
    cellDiv.append(label, valueRow);
    container.appendChild(cellDiv);

    const def = INSTRUMENTS.get(id);
    if (def) {
      label.textContent = def.label;
      const formatted = def.format(null, getSettings());
      value.textContent = formatted.value;
      unit.textContent = formatted.unit;
    }

    return { label, value, unit };
  });

  // Update on nav data
  let lastData: NavigationData | null = null;

  const updateCells = () => {
    const s = getSettings();
    for (let i = 0; i < cellIds.length; i++) {
      const def = INSTRUMENTS.get(s.instrumentCells[i]);
      if (def) {
        cells[i].label.textContent = def.label;
        const formatted = def.format(lastData, s);
        cells[i].value.textContent = formatted.value;
        cells[i].unit.textContent = formatted.unit;
      }
    }
  };

  navManager.subscribe((data) => {
    lastData = data;
    updateCells();
  });

  // Show/hide based on settings
  const applyVisibility = (s: Settings) => {
    container.style.display = s.showInstrumentHUD ? "flex" : "none";
  };
  applyVisibility(getSettings());

  onSettingsChange((s) => {
    applyVisibility(s);
    updateCells();
  });

  return container;
}
