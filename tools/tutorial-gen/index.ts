/**
 * tutorial-gen — a generic, app-neutral engine for capturing and assembling
 * browser-tutorial videos. A tutorial author writes a `Storyboard` plus (for a
 * new app) an `AppAdapter`; the engine handles cursor, capture, captions, and
 * ffmpeg assembly. Nothing here knows about any particular application.
 */
export { buildOneSegment, buildVideo } from "./assemble";
export { captureScenes } from "./capture";
export type { CaptureSize, RenderOptions, VideoSize } from "./config";
export { renderCaptions } from "./overlays";
export { renderTutorial } from "./render";
export type {
  AppAdapter,
  Card,
  Driver,
  Effect,
  Pip,
  Punch,
  Scene,
  Storyboard,
  Theme,
  XY,
} from "./types";
