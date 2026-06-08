/**
 * Named z-order "slots" for plugin (and core overlay) layers.
 *
 * MapLibre draws layers in array order and a bare `addLayer` appends to the
 * top, so plugins need stable insertion points that survive style rebuilds.
 * `applySlotAnchors` splices invisible anchor layers into the assembled chart
 * style at band boundaries; `slotBeforeId` resolves a slot to the anchor a
 * plugin layer should be inserted before. The critical chart ordering (buoys /
 * lights / labels) lives between the `overlay-low` and `overlay-data` anchors
 * and is never exposed to plugins.
 */

import type { LayerSpecification } from "maplibre-gl";
import type { Slot } from "./types";

/** Top-boundary anchors, ordered bottom → top above the chart symbols. */
const TOP_SLOTS: Slot[] = [
  "overlay-data",
  "overlay-nav",
  "vessel",
  "annotations",
];

const ANCHOR_PREFIX = "slot-anchor-";

/** The anchor layer id a plugin layer in `slot` should be inserted before. */
export function slotBeforeId(slot: Slot): string {
  return `${ANCHOR_PREFIX}${slot}`;
}

function anchor(slot: Slot): LayerSpecification {
  return {
    id: slotBeforeId(slot),
    type: "background",
    layout: { visibility: "none" },
  };
}

/**
 * Insert the slot anchor layers into an assembled chart style.
 *
 * - `overlay-low` is placed just above the deepest soundings layer (so layers
 *   in that slot sit below buoys/lights/labels), falling back to the first
 *   symbol layer, then the very top, on providers without soundings.
 * - `overlay-data`, `overlay-nav`, `vessel`, `annotations` stack at the top,
 *   above every chart layer.
 */
export function applySlotAnchors(
  layers: LayerSpecification[],
): LayerSpecification[] {
  const out = [...layers];

  // overlay-low: above soundings, below buoys/lights/labels.
  let lowIdx = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].id.endsWith("-soundg")) {
      lowIdx = i + 1;
      break;
    }
  }
  if (lowIdx < 0) {
    const firstSymbol = out.findIndex((l) => l.type === "symbol");
    lowIdx = firstSymbol >= 0 ? firstSymbol : out.length;
  }
  out.splice(lowIdx, 0, anchor("overlay-low"));

  // The remaining bands stack at the very top, in order.
  for (const slot of TOP_SLOTS) out.push(anchor(slot));

  return out;
}
