#!/usr/bin/env bun

/**
 * Build S-52 sprite sheets with day/dusk/night color variants.
 *
 * Reads source SVGs from tools/sprites/s52/source/, applies color
 * transforms from the IHO CSS stylesheets, and generates sprite
 * sheets via spreet.
 *
 * Usage: bun tools/sprites/build-s52-sprites.ts
 */

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "s52");
const SOURCE_DIR = join(ROOT, "source");
const THEMES = ["day", "dusk", "night", "eink"] as const;
const SPREET = join(process.env.HOME ?? "~", ".cargo/bin/spreet");
const OUTPUT_DIR = join(import.meta.dirname, "../../public/sprites");

type ColourMap = Record<string, string>;

/** Parse a daySvgStyle.css file into a map of class → colour value. */
function parseCss(cssPath: string): ColourMap {
  const css = readFileSync(cssPath, "utf-8");
  const map: ColourMap = {};
  // Match patterns like .sCHBLK { stroke: #000000; } (handles multi-line CSS)
  const re =
    /\.(s|f)([A-Z0-9]+)\s*\{[^}]*?(?:stroke|fill):\s*(#[0-9A-Fa-f]+)[^}]*\}/g;
  for (const m of css.matchAll(re)) {
    const prefix = m[1]; // 's' or 'f'
    const name = m[2]; // e.g. 'CHBLK'
    const colour = m[3]; // e.g. '#000000'
    map[`${prefix}${name}`] = colour;
  }
  return map;
}

/**
 * Apply colours to an SVG by replacing CSS class references with inline
 * fill/stroke attributes.
 *
 * The S-52 SVGs use classes like:
 * - `fCHGRN` → fill with CHGRN colour
 * - `sOUTLW` → stroke with OUTLW colour
 * - `sl` → stroke-linecap/linejoin defaults
 * - `f0` → fill:none
 * - `layout` → display:none (metadata elements)
 *
 * We inline the actual colour values and strip the xml-stylesheet reference.
 */
function applyColours(svg: string, colours: ColourMap): string {
  // Remove the xml-stylesheet processing instruction
  svg = svg.replace(/<\?xml-stylesheet[^?]*\?>\s*/, "");

  // Remove elements with class="layout" or containing "layout" class
  // (symbolBox, svgBox, pivotPoint — metadata only)
  svg = svg.replace(/<(rect|circle)[^>]*class="[^"]*layout[^"]*"[^>]*\/>/g, "");

  // Process each element with class attributes
  svg = svg.replace(
    /(<(?:path|circle|rect|ellipse|polygon|polyline|line|g)\b)([^>]*?)(\s*\/?>)/g,
    (match, tagOpen: string, attrs: string, tagClose: string) => {
      const classMatch = attrs.match(/class="([^"]*)"/);
      if (!classMatch) return match;

      const classes = classMatch[1].split(/\s+/);
      let fill: string | undefined;
      let stroke: string | undefined;
      const extraStyles: string[] = [];

      for (const cls of classes) {
        if (cls === "f0") {
          fill = "none";
        } else if (cls === "sl") {
          extraStyles.push('stroke-linecap="round"', 'stroke-linejoin="round"');
        } else if (cls === "layout") {
        } else if (cls.startsWith("f") && colours[cls]) {
          fill = colours[cls];
        } else if (cls.startsWith("s") && colours[cls]) {
          stroke = colours[cls];
        }
      }

      // Remove the class attribute
      let newAttrs = attrs.replace(/\s*class="[^"]*"/, "");

      // Add inline fill/stroke
      if (fill !== undefined && !newAttrs.includes("fill=")) {
        newAttrs += ` fill="${fill}"`;
      }
      if (stroke !== undefined && !newAttrs.includes("stroke=")) {
        newAttrs += ` stroke="${stroke}"`;
      }
      for (const extra of extraStyles) {
        if (!newAttrs.includes(extra.split("=")[0])) {
          newAttrs += ` ${extra}`;
        }
      }

      return `${tagOpen}${newAttrs}${tagClose}`;
    },
  );

  // Convert mm-based viewBox to a pixel-friendly format
  // The SVGs use width/height in mm — convert to px (1mm ≈ 3.78px at 96dpi)
  // But spreet just needs the viewBox, so we set width/height to match viewBox in px
  svg = svg.replace(
    /width="([0-9.]+)mm"\s*height="([0-9.]+)mm"/,
    (_, w: string, h: string) => {
      const wPx = Math.round(parseFloat(w) * 3.78);
      const hPx = Math.round(parseFloat(h) * 3.78);
      return `width="${wPx}" height="${hPx}"`;
    },
  );

  return svg;
}

/** Light flare symbol names that need 135° rotation (teardrop pointing up → down-right). */
const LIGHT_FLARE_SYMBOLS = new Set(["LIGHTS11", "LIGHTS12", "LIGHTS13"]);

/**
 * Rotate a light flare SVG 135° clockwise around the pivot point (0,0).
 * The source SVGs have the teardrop pointing straight up; per S-52/Chart No.1
 * convention, the flare should point down-right (~135° from north).
 *
 * Wraps all visible content in a <g transform="rotate(135)"> and computes
 * a new square viewBox to contain the rotated shape.
 */
function rotateLightFlare(svg: string): string {
  // Extract current viewBox
  const vbMatch = svg.match(/viewBox="([^"]*)"/);
  if (!vbMatch) return svg;
  const [minX, minY, w, h] = vbMatch[1].split(/\s+/).map(Number);

  // Compute bounding box of rotated corners around origin (0,0)
  const angle = (135 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [minX, minY],
    [minX + w, minY],
    [minX, minY + h],
    [minX + w, minY + h],
  ];
  let rMinX = Infinity;
  let rMinY = Infinity;
  let rMaxX = -Infinity;
  let rMaxY = -Infinity;
  for (const [cx, cy] of corners) {
    const rx = cx * cos - cy * sin;
    const ry = cx * sin + cy * cos;
    rMinX = Math.min(rMinX, rx);
    rMinY = Math.min(rMinY, ry);
    rMaxX = Math.max(rMaxX, rx);
    rMaxY = Math.max(rMaxY, ry);
  }
  // Add small padding
  const pad = 0.2;
  rMinX -= pad;
  rMinY -= pad;
  const rW = rMaxX - rMinX + 2 * pad;
  const rH = rMaxY - rMinY + 2 * pad;

  // Update viewBox and pixel dimensions
  const vbStr = `${rMinX.toFixed(2)} ${rMinY.toFixed(2)} ${rW.toFixed(2)} ${rH.toFixed(2)}`;
  const pxW = Math.round(rW * 3.78);
  const pxH = Math.round(rH * 3.78);
  svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${vbStr}"`);
  svg = svg.replace(/width="\d+"/, `width="${pxW}"`);
  svg = svg.replace(/height="\d+"/, `height="${pxH}"`);

  // Wrap visible content in a rotation group.
  // Insert <g transform="rotate(135)"> after <metadata>...</metadata> block,
  // and close </g> before </svg>
  svg = svg.replace(/(<\/metadata>\s*)/, `$1<g transform="rotate(135)">\n`);
  svg = svg.replace(/(\s*<\/svg>)/, `\n</g>$1`);

  return svg;
}

// --- Main ---

console.log("Building S-52 sprite sheets...");

// Parse CSS colour maps for each theme
const colourMaps: Record<string, ColourMap> = {};
for (const theme of THEMES) {
  colourMaps[theme] = parseCss(join(ROOT, `${theme}SvgStyle.css`));
}

// Get source SVGs
const sourceFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".svg"));
console.log(`  Found ${sourceFiles.length} source SVGs`);

// Generate colour-applied SVGs for each theme
for (const theme of THEMES) {
  const outDir = join(ROOT, theme);
  mkdirSync(outDir, { recursive: true });

  for (const file of sourceFiles) {
    const svg = readFileSync(join(SOURCE_DIR, file), "utf-8");
    let coloured = applyColours(svg, colourMaps[theme]);
    // E-ink: remove fill-opacity to make light flares fully opaque
    if (theme === "eink") {
      coloured = coloured.replace(/\s*fill-opacity="[^"]*"/g, "");
    }
    // Rotate light flare teardrops 135° (up → down-right per S-52 convention)
    const symbolName = file.replace(".svg", "");
    if (LIGHT_FLARE_SYMBOLS.has(symbolName)) {
      coloured = rotateLightFlare(coloured);
    }
    writeFileSync(join(outDir, file), coloured);
  }
  console.log(`  Generated ${sourceFiles.length} ${theme} SVGs`);
}

// Run spreet for each theme
for (const theme of THEMES) {
  const inputDir = join(ROOT, theme);
  const outputBase = join(OUTPUT_DIR, `s52-${theme}`);

  // Standard resolution
  execSync(`${SPREET} "${inputDir}" "${outputBase}"`, { stdio: "inherit" });
  // Retina (@2x)
  execSync(`${SPREET} --retina "${inputDir}" "${outputBase}@2x"`, {
    stdio: "inherit",
  });
  // Ensure trailing newline on JSON files (spreet omits it)
  for (const jsonFile of [`${outputBase}.json`, `${outputBase}@2x.json`]) {
    const content = readFileSync(jsonFile, "utf-8");
    if (!content.endsWith("\n")) {
      writeFileSync(jsonFile, `${content}\n`);
    }
  }
  console.log(`  Built s52-${theme} sprite sheets (1x + @2x)`);
}

console.log("Done!");
