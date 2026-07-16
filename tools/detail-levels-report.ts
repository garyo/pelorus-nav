/**
 * Generate docs/detail-levels.md — a reference matrix of which chart layers
 * render at each detail level (Base / Standard / Standard+ / Full) and from
 * what zoom, extracted from the live style builder so it never drifts from
 * the code.
 *
 * Usage: bun tools/detail-levels-report.ts
 *
 * Regenerate after changing LAYER_CATEGORIES, the detail-level minzoom maps
 * (OTHER_STANDARD_MINZOOM / STANDARD_DETAIL_MINZOOM), any layer's minzoom,
 * or the detail-gated filters (deep soundings, minor lights).
 */
import { writeFileSync } from "node:fs";
import { getNauticalLayers } from "../src/chart/styles/index";

const LEVELS = [
  { offset: -1, name: "Base" },
  { offset: 0, name: "Standard" },
  { offset: 1, name: "Standard+" },
  { offset: 2, name: "Full" },
] as const;

interface Cell {
  minzoom: number;
  filtered: boolean;
}

interface Row {
  sourceLayer: string;
  id: string;
  cells: (Cell | null)[];
}

const rows = new Map<string, Row>();

LEVELS.forEach(({ offset }, levelIdx) => {
  for (const layer of getNauticalLayers("src", "meters", offset, {})) {
    const l = layer as unknown as {
      id: string;
      "source-layer"?: string;
      minzoom?: number;
      filter?: unknown;
    };
    if (!l["source-layer"]) continue;
    let row = rows.get(l.id);
    if (!row) {
      row = {
        sourceLayer: l["source-layer"],
        id: l.id,
        cells: [null, null, null, null],
      };
      rows.set(l.id, row);
    }
    row.cells[levelIdx] = {
      minzoom: l.minzoom ?? 0,
      filtered: l.filter !== undefined,
    };
  }
});

const fmt = (c: Cell | null): string =>
  c === null
    ? "—"
    : `${c.minzoom === 0 ? "all" : `z${c.minzoom}+`}${c.filtered ? " \\*" : ""}`;

const sorted = [...rows.values()].sort((a, b) =>
  (a.sourceLayer + a.id).localeCompare(b.sourceLayer + b.id),
);

const lines: string[] = [
  "# Detail levels — layer visibility matrix",
  "",
  "**Generated file — do not edit.** Regenerate with `bun tools/detail-levels-report.ts`.",
  "",
  "Each cell is the zoom a style layer becomes visible at that Detail-slider",
  "position (`all` = every zoom, `—` = not built). Extracted from",
  "`getNauticalLayers()` so it always matches the shipped style.",
  "",
  "Cross-cutting behavior not visible in the table:",
  "",
  "- `\\*` marks a layer with a feature filter. Three are detail-dependent:",
  "  at Standard and Base, `s57-soundg` hides soundings deeper than the",
  "  user's deep threshold until z13, and `s57-lights`/`s57-lights-glow`",
  "  hide lights with range < 10 nm until z10.",
  "- Hazard icons (UWTROC/OBSTRN/WRECKS) claim collision space below z13 at",
  "  every detail level, so dense clusters self-thin; at z13+ all draw.",
  "- Layer-group toggles (Settings › Charts & Layers) flip `visibility` on",
  "  top of this matrix — a toggle can only hide layers this table says exist.",
  "",
  "| Source layer | Style layer | Base | Standard | Standard+ | Full |",
  "|---|---|---|---|---|---|",
];

for (const r of sorted) {
  lines.push(
    `| ${r.sourceLayer} | \`${r.id}\` | ${r.cells.map(fmt).join(" | ")} |`,
  );
}
lines.push("");

writeFileSync("docs/detail-levels.md", lines.join("\n"));
console.log(`wrote docs/detail-levels.md (${rows.size} layers)`);
