import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import {
  type RenderOptions,
  type ResolvedConfig,
  resolveConfig,
} from "./config";
import { installCursorScript } from "./cursor";
import { makeDriver } from "./driver";
import type { AppAdapter, Scene, Storyboard } from "./types";

/**
 * App-neutral capture: drives each scene in headed Chromium (real GPU → smooth
 * animation) and records it to clips/<id>.mp4. All app-specific behaviour —
 * seeding, URLs, readiness, camera ops — comes through the `AppAdapter`; this
 * module knows nothing about the application. Each clip has ~prerollMs of
 * boot/settle at the head; the assemble trims to the usable footage.
 */

/**
 * Encode the captured JPEG frames (variable-rate, one timestamp each) into a
 * clean constant-fps H.264. Uses the concat demuxer with per-frame durations
 * derived from the screencast timestamps, then resamples to CFR. Encoded near
 * lossless (CRF 12) — the assemble re-encodes at delivery quality anyway.
 *
 * `wallSec` is the real elapsed capture time. Screencast only emits frames on
 * paint, so a static end-hold (e.g. a panel sitting still) produces no trailing
 * frames; we pad the final frame's duration out to wallSec so those holds
 * survive. (Mid-clip static holds already survive: the held frame's duration is
 * the gap to the next paint.)
 */
function encodeFrames(
  dir: string,
  count: number,
  times: number[],
  wallSec: number,
  fps: number,
  out: string,
): void {
  const name = (i: number) => join(dir, `f-${String(i).padStart(6, "0")}.jpg`);
  const spanned = times[count - 1] - times[0]; // time up to the last painted frame
  const tailPad = Math.min(Math.max(wallSec - spanned, 1 / fps), 8);
  const lines: string[] = [];
  for (let i = 1; i <= count; i++) {
    lines.push(`file '${name(i)}'`);
    const d = i < count ? times[i] - times[i - 1] || 1 / fps : tailPad;
    lines.push(`duration ${Math.min(Math.max(d, 0.001), 8).toFixed(4)}`);
  }
  lines.push(`file '${name(count)}'`); // repeat last so its duration is honored
  const listPath = join(dir, "frames.txt");
  writeFileSync(listPath, lines.join("\n"));
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-vf",
      `fps=${fps},format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "12",
      "-r",
      `${fps}`,
      out,
    ],
    { stdio: "inherit" },
  );
}

async function captureScene<Setup, App>(
  scene: Scene<Setup, App>,
  adapter: AppAdapter<Setup, App>,
  cfg: ResolvedConfig,
): Promise<void> {
  const { width, height, deviceScaleFactor } = cfg.captureSize;
  const rawDir = join(cfg.rawDir, scene.id);
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--enable-webgl", "--hide-scrollbars", "--mute-audio"],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  await page.addInitScript(installCursorScript);
  await adapter.prepare(page, scene);

  // Playwright's built-in recordVideo is ~1 Mbps VP8 — blocky on busy content.
  // Capture full-quality JPEG frames ourselves via CDP screencast (kept as a
  // VFR stream via each frame's timestamp), then encode to a clean H.264.
  const client = await context.newCDPSession(page);
  const frameTimes: number[] = [];
  let frameCount = 0;
  client.on("Page.screencastFrame", (f) => {
    writeFileSync(
      join(rawDir, `f-${String(++frameCount).padStart(6, "0")}.jpg`),
      Buffer.from(f.data, "base64"),
    );
    frameTimes.push(f.metadata.timestamp ?? frameCount / cfg.fps);
    void client
      .send("Page.screencastFrameAck", { sessionId: f.sessionId })
      .catch(() => {});
  });
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: cfg.quality,
    maxWidth: width * deviceScaleFactor,
    maxHeight: height * deviceScaleFactor,
    everyNthFrame: 1,
  });
  const screencastStart = Date.now();

  await page.goto(adapter.urlFor(scene), { waitUntil: "domcontentloaded" });
  await adapter.ready(page);
  await adapter.afterReady?.(page, scene);
  await page.waitForTimeout(cfg.prerollMs);

  const ctx = makeDriver(page, adapter.makeApp(page));
  await scene.drive(ctx);

  const wallSec = (Date.now() - screencastStart) / 1000;
  await client.send("Page.stopScreencast").catch(() => {});
  await context.close();
  await browser.close();

  if (frameCount === 0)
    throw new Error(`no frames captured for scene "${scene.id}"`);
  mkdirSync(cfg.clipsDir, { recursive: true });
  const out = join(cfg.clipsDir, `${scene.id}.mp4`);
  rmSync(out, { force: true });
  encodeFrames(rawDir, frameCount, frameTimes, wallSec, cfg.fps, out);
  console.log(`✓ ${scene.id} → ${out}  (${frameCount} frames)`);
}

/** Capture every scene (or the named subset) to clips/<id>.mp4. */
export async function captureScenes<Setup, App>(
  storyboard: Storyboard<Setup, App>,
  adapter: AppAdapter<Setup, App>,
  opts: RenderOptions,
  sceneIds?: string[],
): Promise<void> {
  const cfg = resolveConfig(opts);
  const want = sceneIds ?? [];
  const scenes = want.length
    ? storyboard.scenes.filter((s) => want.includes(s.id))
    : storyboard.scenes;
  if (!scenes.length) {
    const known = storyboard.scenes.map((s) => s.id).join(", ");
    throw new Error(
      `No scenes matched ${JSON.stringify(want)}. Known: ${known}`,
    );
  }
  for (const scene of scenes) await captureScene(scene, adapter, cfg);
}
