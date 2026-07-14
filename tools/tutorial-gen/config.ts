import { join } from "node:path";

/**
 * Engine configuration and its defaults. `RenderOptions` is the small surface a
 * caller passes; `resolveConfig` fills in defaults and derives all working
 * directories from `root`, so the rest of the engine works with concrete paths.
 */

/** Capture-time viewport + pixel density. */
export interface CaptureSize {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/** Delivery-resolution frame. */
export interface VideoSize {
  width: number;
  height: number;
}

/** Options accepted by the top-level engine entry points. */
export interface RenderOptions {
  /** Working directory holding clips/, .raw/, .segments/, assets/. */
  root: string;
  /** Final output file (default `<root>/out/tutorial.mp4`). */
  out?: string;
  /** Capture viewport + density (default 1280x720 @2x). */
  captureSize?: CaptureSize;
  /** Delivery resolution (default 1920x1080). */
  videoSize?: VideoSize;
  /** Frame rate for capture + delivery (default 30). */
  fps?: number;
  /** Screencast JPEG quality (default 95). */
  quality?: number;
  /** Recorded boot/settle lead-in before drive() runs, ms (default 3500). */
  prerollMs?: number;
  /** Intermediate-segment CRF (default "12"). */
  segCrf?: string;
  /** Final-delivery CRF (default "14"). */
  finalCrf?: string;
}

export interface ResolvedConfig {
  root: string;
  outFile: string;
  clipsDir: string;
  rawDir: string;
  segDir: string;
  capsDir: string;
  captureSize: CaptureSize;
  videoSize: VideoSize;
  fps: number;
  quality: number;
  prerollMs: number;
  segCrf: string;
  finalCrf: string;
}

export function resolveConfig(opts: RenderOptions): ResolvedConfig {
  const { root } = opts;
  return {
    root,
    outFile: opts.out ?? join(root, "out", "tutorial.mp4"),
    clipsDir: join(root, "clips"),
    rawDir: join(root, ".raw"),
    segDir: join(root, ".segments"),
    capsDir: join(root, "assets", "captions"),
    captureSize: opts.captureSize ?? {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
    },
    videoSize: opts.videoSize ?? { width: 1920, height: 1080 },
    fps: opts.fps ?? 30,
    quality: opts.quality ?? 95,
    prerollMs: opts.prerollMs ?? 3500,
    segCrf: opts.segCrf ?? "12",
    finalCrf: opts.finalCrf ?? "14",
  };
}
