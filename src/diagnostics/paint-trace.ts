/**
 * Repaint tracing for e-ink tuning, off in shipping builds.
 *
 * E-ink panels refresh in response to what actually changes on screen, so
 * "why did that flash?" is a question about DOM mutations and canvas
 * repaints during a specific interaction — not about frame rate. Flip
 * {@link PAINT_TRACE} on, reproduce the interaction, and pull the device
 * diag log: each traced window reports how many mutations landed, which
 * elements produced them, and how many MapLibre renders ran alongside.
 *
 * MutationObserver sees DOM changes only. Map redraws paint to a canvas
 * without mutating anything, so they are counted separately via the map's
 * render event — on e-ink those are the expensive ones.
 */

import { diag } from "../utils/diag";

/** Flip to true to trace; never true in a shipping build. */
export const PAINT_TRACE = false;

let observer: MutationObserver | null = null;
let counts = new Map<string, number>();
let mapRenders = 0;
let label = "";
let startedAt = 0;

/** Short, stable identity for a mutated node: what a reader can act on. */
function describe(node: Node): string {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!el) return "(detached)";
  const cls = el.className;
  const name =
    typeof cls === "string" && cls.trim()
      ? `.${cls.trim().split(/\s+/).join(".")}`
      : el.id
        ? `#${el.id}`
        : el.tagName.toLowerCase();
  return name.length > 60 ? `${name.slice(0, 60)}…` : name;
}

/** Count a map render into the open window, if any. */
export function notePaintTraceRender(): void {
  if (observer) mapRenders++;
}

/** Begin a traced window; a second call replaces the first. */
export function startPaintTrace(what: string): void {
  if (!PAINT_TRACE) return;
  stopPaintTrace();
  label = what;
  counts = new Map();
  mapRenders = 0;
  startedAt = performance.now();
  observer = new MutationObserver((records) => {
    for (const r of records) {
      const key =
        r.type === "childList"
          ? `${describe(r.target)} childList`
          : r.type === "attributes"
            ? `${describe(r.target)} @${r.attributeName}`
            : `${describe(r.target)} text`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}

/** End the window and write its summary to the device diag log. */
export function stopPaintTrace(outcome = ""): void {
  if (!observer) return;
  const records = observer.takeRecords();
  observer.disconnect();
  observer = null;
  for (const r of records) counts.set(describe(r.target), 1);
  const ms = Math.round(performance.now() - startedAt);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${k}×${n}`)
    .join(" | ");
  diag(
    "paint",
    `${label} ${ms}ms ${outcome} dom=${total} mapRenders=${mapRenders} :: ${top}`,
  );
}
