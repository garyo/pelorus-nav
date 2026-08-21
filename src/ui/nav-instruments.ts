/**
 * Active-navigation instruments (BRG / DTW / VMG / STR) for the Instrument
 * HUD. All base instruments live in InstrumentHUD.ts; these four depend on
 * the ActiveNavigationManager, so they register here once it exists.
 */
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import { applyDeclination, bearingModeLabel } from "../utils/magnetic";
import {
  convertSpeed,
  formatNavDistanceNM,
  speedUnitLabel,
} from "../utils/units";
import { INSTRUMENTS } from "./InstrumentHUD";

export function registerNavInstruments(
  activeNav: ActiveNavigationManager,
): void {
  INSTRUMENTS.set("brg", {
    id: "brg",
    label: "Bearing to wpt",
    shortLabel: "BRG",
    format(data, settings) {
      const info = activeNav.getInfo();
      const mode = settings.bearingMode;
      const label = bearingModeLabel(mode);
      // data is null when the fix is stale — info is then computed from a stale
      // position, so blank like the motion instruments rather than freezing.
      if (!info || !data) return { value: "--", unit: label };
      const lat = data?.latitude ?? 0;
      const lon = data?.longitude ?? 0;
      const display = applyDeclination(info.bearingDeg, mode, lat, lon);
      return {
        value: `${Math.round(display).toString().padStart(3, "0")}\u00b0`,
        unit: label,
      };
    },
  });

  INSTRUMENTS.set("dtw", {
    id: "dtw",
    label: "Dist to wpt",
    shortLabel: "DTW",
    format(data) {
      const info = activeNav.getInfo();
      // Blank on a stale fix (data null) — see the BRG formatter.
      if (!info || !data) return { value: "--", unit: "NM" };
      return { value: formatNavDistanceNM(info.distanceNM), unit: "NM" };
    },
  });

  INSTRUMENTS.set("vmg", {
    id: "vmg",
    label: "Velocity made good",
    shortLabel: "VMG",
    format(data, settings) {
      const info = activeNav.getInfo();
      const unit = speedUnitLabel(settings.speedUnit);
      // Blank on a stale fix (data null) — see the BRG formatter.
      if (!info || !data || info.vmgKn == null) return { value: "--", unit };
      const v = info.vmgKn;
      const display =
        v < 0
          ? -convertSpeed(-v, settings.speedUnit)
          : convertSpeed(v, settings.speedUnit);
      return { value: display.toFixed(1), unit };
    },
  });

  INSTRUMENTS.set("steer", {
    id: "steer",
    label: "Steer",
    shortLabel: "STR",
    format(data) {
      const info = activeNav.getInfo();
      // Blank on a stale fix (data null) — see the BRG formatter.
      if (!info || !data || info.steerDeg == null)
        return { value: "--", unit: "" };
      const d = info.steerDeg;
      if (Math.abs(d) < 1) return { value: "0\u00b0", unit: "" };
      const mag = Math.round(Math.abs(d));
      return d < 0
        ? { value: `\u2190${mag}\u00b0`, unit: "" }
        : { value: `${mag}\u00b0\u2192`, unit: "" };
    },
  });
}
