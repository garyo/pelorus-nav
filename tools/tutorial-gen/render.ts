import { buildVideo } from "./assemble";
import { captureScenes } from "./capture";
import type { RenderOptions } from "./config";
import { renderCaptions } from "./overlays";
import type { AppAdapter, Storyboard } from "./types";

/**
 * Full pipeline: capture every scene, render captions, assemble the video.
 * Sub-commands (`captureScenes`, `renderCaptions`, `buildVideo`) are exported
 * separately for re-running only part of the pipeline (e.g. rebuilding the
 * assembly from existing clips without re-capturing).
 */
export async function renderTutorial<Setup, App>(
  storyboard: Storyboard<Setup, App>,
  adapter: AppAdapter<Setup, App>,
  opts: RenderOptions,
): Promise<void> {
  await captureScenes(storyboard, adapter, opts);
  renderCaptions(storyboard, opts);
  buildVideo(storyboard, opts);
}
