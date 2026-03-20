/**
 * Parse bearing input strings and provide a small inline DOM input.
 *
 * Accepted formats:
 * - "121M" or "121°M" → magnetic bearing 121°
 * - "106T" or "106°T" → true bearing 106°
 * - "121" → uses current bearingMode setting
 */

import type { BearingMode } from "../../settings";
import { getDeclination } from "../../utils/magnetic";

export interface ParsedBearing {
  /** Bearing in degrees TRUE, ready for storage. */
  trueBearing: number;
  /** Original label to store, e.g. "121°M". */
  label: string;
}

/**
 * Parse a user-entered bearing string into a true bearing.
 * @param input Raw user input, e.g. "121M", "106T", "121"
 * @param defaultMode Fallback mode when no M/T suffix
 * @param lat Latitude at anchor point (for declination lookup)
 * @param lon Longitude at anchor point (for declination lookup)
 */
export function parseBearingInput(
  input: string,
  defaultMode: BearingMode,
  lat: number,
  lon: number,
): ParsedBearing | null {
  const trimmed = input.trim().replace(/°/g, "");
  if (!trimmed) return null;

  // Extract optional M/T suffix
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([MTmt])?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (Number.isNaN(value) || value < 0 || value >= 360) return null;

  const suffix = match[2]?.toUpperCase() as "M" | "T" | undefined;
  const mode: BearingMode =
    suffix === "M" ? "magnetic" : suffix === "T" ? "true" : defaultMode;

  let trueBearing: number;
  let label: string;

  if (mode === "magnetic") {
    // Magnetic → True: add declination (east-positive)
    const decl = getDeclination(lat, lon);
    trueBearing = (((value + decl) % 360) + 360) % 360;
    label = `${Math.round(value).toString().padStart(3, "0")}°M`;
  } else {
    trueBearing = value;
    label = `${Math.round(value).toString().padStart(3, "0")}°T`;
  }

  return { trueBearing, label };
}

/**
 * Create a small inline bearing input element.
 * Returns the container div. Calls `onSubmit` with the raw text on Enter.
 * Calls `onCancel` on Escape.
 */
export function createBearingInput(
  onSubmit: (value: string) => void,
  onCancel: () => void,
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "plot-bearing-input";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Bearing (e.g. 121M)";
  input.className = "plot-bearing-field";

  const okBtn = document.createElement("button");
  okBtn.className = "plot-toolbar-btn";
  okBtn.textContent = "OK";

  container.append(input, okBtn);

  const submit = () => {
    const val = input.value.trim();
    if (val) onSubmit(val);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    e.stopPropagation(); // don't let MapLibre handle these keys
  });

  okBtn.addEventListener("click", submit);

  // Auto-focus after append
  requestAnimationFrame(() => input.focus());

  return container;
}
