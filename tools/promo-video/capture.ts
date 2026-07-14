import { captureScenes } from "../tutorial-gen/index";
import { PROMO } from "./beats";
import { PROMO_OPTIONS } from "./options";
import { pelorusAdapter } from "./pelorus-adapter";

/**
 * Capture promo scenes from the live dev server (`bun dev` on :5173).
 *
 *   bun run tools/promo-video/capture.ts            # all scenes
 *   bun run tools/promo-video/capture.ts live-nav   # only named scenes
 *
 * Launches headed Chromium (real GPU → smooth MapLibre) and records each scene
 * to clips/<id>.mp4 at 2x. Each clip has ~preroll of boot/settle at the head;
 * the assemble (build.ts) trims to the usable footage.
 */
const ids = process.argv.slice(2);
await captureScenes(PROMO, pelorusAdapter, PROMO_OPTIONS, ids);
