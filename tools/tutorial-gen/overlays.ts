import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type RenderOptions, resolveConfig } from "./config";
import type { Storyboard, Theme } from "./types";

/**
 * Render each scene's caption to a transparent lower-third PNG at delivery
 * resolution, taking the text straight from the storyboard (the single source
 * of truth). The assemble overlays these, so re-wording a caption is an edit +
 * a re-run — no re-capture. App-neutral: styling comes from `storyboard.theme`.
 */

interface CaptionStyle {
  font: string;
  accent: string;
  panel: string;
  pt: number;
  textX: number;
  barX: number;
  capTop: number;
}

function styleFrom(theme: Theme): CaptionStyle {
  return {
    font: theme.font,
    accent: theme.accent ?? "#4ea3ff",
    panel: theme.panel ?? "rgba(8,15,28,0.60)",
    pt: theme.captionPointSize ?? 52,
    textX: theme.captionTextX ?? 132,
    barX: theme.captionBarX ?? 96,
    capTop: theme.captionTop ?? 838,
  };
}

/** Measure the caption's rendered pixel width so the pill fits it snugly. */
function textWidth(caption: string, s: CaptionStyle): number {
  const w = execFileSync("magick", [
    "-font",
    s.font,
    "-pointsize",
    `${s.pt}`,
    `label:${caption}`,
    "-format",
    "%w",
    "info:",
  ])
    .toString()
    .trim();
  return Number.parseInt(w, 10);
}

function render(
  id: string,
  caption: string,
  outDir: string,
  w: number,
  h: number,
  s: CaptionStyle,
): void {
  const out = join(outDir, `${id}.png`);
  const tw = textWidth(caption, s);
  // Soft rounded pill sized to the text (not a full-width bottom scrim, which
  // covers app controls). Slight blur feathers its edges.
  const x1 = s.barX - 22;
  const x2 = s.textX + tw + 40;
  const y1 = s.capTop - 22;
  const y2 = s.capTop + s.pt + 28;
  execFileSync("magick", [
    "-size",
    `${w}x${h}`,
    "canvas:none",
    "(",
    "-size",
    `${w}x${h}`,
    "canvas:none",
    "-fill",
    s.panel,
    "-draw",
    `roundrectangle ${x1},${y1} ${x2},${y2} 22,22`,
    "-blur",
    "0x5",
    ")",
    "-composite",
    // brand accent bar to the left of the text
    "-fill",
    s.accent,
    "-draw",
    `rectangle ${s.barX},${s.capTop + 8} ${s.barX + 8},${s.capTop + s.pt + 14}`,
    // drop shadow (dark, offset) then the white caption on top
    "-font",
    s.font,
    "-pointsize",
    `${s.pt}`,
    "-gravity",
    "NorthWest",
    "-fill",
    "rgba(0,0,0,0.72)",
    "-annotate",
    `+${s.textX + 2}+${s.capTop + 3}`,
    caption,
    "-fill",
    "white",
    "-annotate",
    `+${s.textX}+${s.capTop}`,
    caption,
    out,
  ]);
  console.log(`✓ ${id} → ${out}  "${caption}"`);
}

/** Render caption PNGs for every scene that has a caption (or the named subset). */
export function renderCaptions(
  storyboard: Storyboard,
  opts: RenderOptions,
  sceneIds?: string[],
): void {
  const cfg = resolveConfig(opts);
  const s = styleFrom(storyboard.theme);
  mkdirSync(cfg.capsDir, { recursive: true });
  const only = sceneIds ?? [];
  for (const scene of storyboard.scenes) {
    if (only.length && !only.includes(scene.id)) continue;
    if (!scene.caption) continue;
    render(
      scene.id,
      scene.caption,
      cfg.capsDir,
      cfg.videoSize.width,
      cfg.videoSize.height,
      s,
    );
  }
}
