import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type RenderOptions, resolveConfig } from "./config";
import type { Card, Music, Pip, Punch, Scene, Storyboard } from "./types";

/**
 * Assemble the finished tutorial from captured scene clips. Fully scripted so a
 * re-run is one call: trims each scene to its [in, in+duration] window, burns in
 * the lower-third caption with a fade, optionally punches in (Ken-Burns) or
 * floats a PiP magnifier, then cross-dissolves the whole sequence between an
 * intro and outro card. App-neutral: everything comes from the storyboard.
 */

/** Resolved layout for one assemble run. */
interface Asm {
  W: number;
  H: number;
  fps: number;
  segCrf: string;
  finalCrf: string;
  xfade: number;
  font: string;
  clips: string;
  caps: string;
  seg: string;
  out: string;
  music?: Music;
}

const ff = (args: string[]) =>
  execFileSync("ffmpeg", ["-y", ...args], { stdio: "inherit" });

const punchOf = (s: Scene): Punch | undefined =>
  s.effects?.find((e): e is Punch => e.kind === "punch");
const pipOf = (s: Scene): Pip | undefined =>
  s.effects?.find((e): e is Pip => e.kind === "pip");

/** Base video filter for a scene: cover-scale to delivery, optional Ken-Burns. */
function baseFilter(a: Asm, dur: number, punch: Punch | undefined): string {
  const cover = `scale=${a.W}:${a.H}:force_original_aspect_ratio=increase,crop=${a.W}:${a.H},fps=${a.fps},setsar=1`;
  if (!punch) return `[0:v]${cover}[base]`;
  // Smooth push-in via zoompan (crop w/h can't be time-varying). Zoom eases
  // from 1 to punch.zoom across the segment's frames using `on`; x/y pan toward
  // (cx,cy) and clamp so the window stays in-frame.
  const n = Math.max(2, Math.round(dur * a.fps));
  const u = `(on/${n - 1})`;
  const s = `(${u}*${u}*(3-2*${u}))`; // smoothstep
  const z = `(1+${(punch.zoom - 1).toFixed(4)}*${s})`;
  const x = `max(0\\,min(iw*${punch.cx}-(iw/zoom)/2\\,iw-iw/zoom))`;
  const y = `max(0\\,min(ih*${punch.cy}-(ih/zoom)/2\\,ih-ih/zoom))`;
  return `[0:v]${cover},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${a.W}x${a.H}:fps=${a.fps}[base]`;
}

/** PiP magnifier chain: crop [bp] → enlarge → labelled bordered card → [pip]. */
function pipChain(a: Asm, p: Pip): string {
  const sw = Math.round(p.crop * p.scale);
  // Navy card (top strip for the label) then a thin brand-blue outline.
  return (
    `[bp]crop=${p.crop}:${p.crop}:${p.cropX}:${p.cropY},scale=${sw}:${sw},` +
    `pad=${sw + 8}:${sw + 46}:4:42:color=0x0c172a,` +
    `drawtext=fontfile=${a.font}:text='${p.label}':fontcolor=white:fontsize=24:x=16:y=9,` +
    `pad=iw+6:ih+6:3:3:color=0x4ea3ff,` +
    `format=rgba,fade=in:st=1.2:d=0.5:alpha=1[pip]`
  );
}

/** Build one scene segment (trim + cover/punch + caption fade + PiP). */
function buildSegment(a: Asm, scene: Scene): string {
  const { id, in: inSec, duration: dur } = scene;
  const punch = punchOf(scene);
  const pip = pipOf(scene);
  const hasCap = !!scene.caption;
  const out = join(a.seg, `${id}.mp4`);

  const inputs = [
    "-ss",
    `${inSec}`,
    "-t",
    `${dur}`,
    "-i",
    join(a.clips, `${id}.mp4`),
  ];
  const parts = [baseFilter(a, dur, punch)];

  if (hasCap) {
    // Loop the caption still into a dur-length stream so the fade filters have
    // frames to act on (a single-frame input can't animate the fade in/out).
    inputs.push(
      "-loop",
      "1",
      "-framerate",
      `${a.fps}`,
      "-t",
      `${dur}`,
      "-i",
      join(a.caps, `${id}.png`),
    );
    const capIn = 0.35;
    const capOutStart = Math.max(capIn + 0.5, dur - a.xfade - 0.35);
    parts.push(
      `[1:v]format=rgba,fade=in:st=0:d=${capIn}:alpha=1,fade=out:st=${capOutStart.toFixed(2)}:d=0.4:alpha=1[cap]`,
    );
  }

  if (pip) {
    const sw = Math.round(pip.crop * pip.scale);
    const cardW = sw + 14;
    const px = a.W - cardW - 40;
    parts.push(`[base]split[base0][bp]`, pipChain(a, pip));
    if (hasCap) {
      parts.push(
        `[base0][cap]overlay=0:0[t1]`,
        `[t1][pip]overlay=${px}:88:format=auto,format=yuv420p[v]`,
      );
    } else {
      parts.push(`[base0][pip]overlay=${px}:88:format=auto,format=yuv420p[v]`);
    }
  } else if (hasCap) {
    parts.push(`[base][cap]overlay=0:0:format=auto,format=yuv420p[v]`);
  } else {
    parts.push(`[base]format=yuv420p[v]`);
  }

  ff([
    ...inputs,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    a.segCrf,
    "-pix_fmt",
    "yuv420p",
    "-r",
    `${a.fps}`,
    out,
  ]);
  return out;
}

/** Build a title/outro card segment from a still, with a fade from/to black. */
function buildCard(
  a: Asm,
  name: string,
  src: string,
  dur: number,
  fadeIn: boolean,
  fadeOut: boolean,
): string {
  const out = join(a.seg, `${name}.mp4`);
  const fades = [
    `scale=${a.W}:${a.H}:force_original_aspect_ratio=increase,crop=${a.W}:${a.H},fps=${a.fps},setsar=1`,
    fadeIn ? "fade=in:st=0:d=0.6" : "",
    fadeOut ? `fade=out:st=${(dur - 0.6).toFixed(2)}:d=0.6` : "",
    "format=yuv420p",
  ]
    .filter(Boolean)
    .join(",");
  ff([
    "-loop",
    "1",
    "-t",
    `${dur}`,
    "-i",
    src,
    "-filter_complex",
    `[0:v]${fades}[v]`,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    a.segCrf,
    "-pix_fmt",
    "yuv420p",
    "-r",
    `${a.fps}`,
    out,
  ]);
  return out;
}

/** Concatenate segments with xfade cross-dissolves into the final file. */
function concatXfade(a: Asm, segs: { path: string; dur: number }[]): void {
  const inputs = segs.flatMap((s) => ["-i", s.path]);
  const parts: string[] = [];
  let prev = "[0:v]";
  let running = segs[0].dur;
  for (let i = 1; i < segs.length; i++) {
    const offset = (running - a.xfade).toFixed(3);
    const label = i === segs.length - 1 ? "[vout]" : `[x${i}]`;
    parts.push(
      `${prev}[${i}:v]xfade=transition=fade:duration=${a.xfade}:offset=${offset}${label}`,
    );
    prev = label;
    running = running + segs[i].dur - a.xfade;
  }

  // Optional backing music: take only the audio stream of the track, trim it to
  // the final video length, and fade both ends. `running` is the true finished
  // duration (accounts for every xfade overlap), so the fade-out lands exactly
  // at the end no matter how the scenes were re-timed.
  const audioArgs: string[] = ["-an"];
  if (a.music) {
    const idx = segs.length;
    const gain = a.music.gainDb ?? 0;
    const fin = a.music.fadeInSec ?? 0.8;
    const fout = a.music.fadeOutSec ?? 3;
    const foutSt = Math.max(0, running - fout).toFixed(3);
    const chain = [
      `atrim=0:${running.toFixed(3)}`,
      "asetpts=PTS-STARTPTS",
      gain !== 0 ? `volume=${gain}dB` : "",
      `afade=t=in:st=0:d=${fin}`,
      `afade=t=out:st=${foutSt}:d=${fout}`,
    ]
      .filter(Boolean)
      .join(",");
    inputs.push("-i", a.music.path);
    parts.push(`[${idx}:a]${chain}[aout]`);
    audioArgs.length = 0;
    audioArgs.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  }

  mkdirSync(dirname(a.out), { recursive: true });
  ff([
    ...inputs,
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    ...audioArgs,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    a.finalCrf,
    "-pix_fmt",
    "yuv420p",
    "-r",
    `${a.fps}`,
    "-movflags",
    "+faststart",
    a.out,
  ]);
  console.log(`\n✓ built ${a.out}  (~${running.toFixed(1)}s)`);
}

function asmFrom(storyboard: Storyboard, opts: RenderOptions): Asm {
  const cfg = resolveConfig(opts);
  return {
    W: cfg.videoSize.width,
    H: cfg.videoSize.height,
    fps: cfg.fps,
    segCrf: cfg.segCrf,
    finalCrf: cfg.finalCrf,
    xfade: storyboard.transition?.sec ?? 0.5,
    font: storyboard.theme.font,
    clips: cfg.clipsDir,
    caps: cfg.capsDir,
    seg: cfg.segDir,
    out: cfg.outFile,
    music: storyboard.music,
  };
}

/** Rebuild a single scene segment (debug helper). Returns its path. */
export function buildOneSegment(
  storyboard: Storyboard,
  opts: RenderOptions,
  id: string,
): string {
  const a = asmFrom(storyboard, opts);
  mkdirSync(a.seg, { recursive: true });
  const scene = storyboard.scenes.find((s) => s.id === id);
  if (!scene) throw new Error(`unknown scene "${id}"`);
  return buildSegment(a, scene);
}

/** Assemble the whole tutorial from existing clips + caption PNGs. */
export function buildVideo(storyboard: Storyboard, opts: RenderOptions): void {
  const a = asmFrom(storyboard, opts);
  rmSync(a.seg, { recursive: true, force: true });
  mkdirSync(a.seg, { recursive: true });

  const segs: { path: string; dur: number }[] = [];
  const card = (name: string, c: Card, fadeIn: boolean, fadeOut: boolean) =>
    segs.push({
      path: buildCard(a, name, c.image, c.sec, fadeIn, fadeOut),
      dur: c.sec,
    });

  if (storyboard.intro) card("title", storyboard.intro, true, false);
  for (const scene of storyboard.scenes) {
    segs.push({ path: buildSegment(a, scene), dur: scene.duration });
  }
  if (storyboard.outro) card("outro", storyboard.outro, false, true);
  concatXfade(a, segs);
}
