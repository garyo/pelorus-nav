import { renderCaptions } from "../tutorial-gen/index";
import { PROMO } from "./beats";
import { PROMO_OPTIONS } from "./options";

/**
 * Render each scene's caption to a 1920x1080 transparent lower-third PNG, taking
 * the text from the storyboard (the single source of truth). The build overlays
 * these onto each scene, so re-wording a caption is an edit + a re-run.
 *
 *   bun run tools/promo-video/overlays.ts            # all captions
 *   bun run tools/promo-video/overlays.ts cob        # only named scenes
 */
const ids = process.argv.slice(2);
renderCaptions(PROMO, PROMO_OPTIONS, ids);
