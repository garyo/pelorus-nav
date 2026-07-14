import { buildOneSegment, buildVideo } from "../tutorial-gen/index";
import { PROMO } from "./beats";
import { PROMO_OPTIONS } from "./options";

/**
 * Assemble the finished promo from the captured scene clips. Fully scripted so a
 * re-run is one command.
 *
 *   bun run tools/promo-video/build.ts            # full build → out/pelorus-promo-v2.mp4
 *   bun run tools/promo-video/build.ts --seg cob  # rebuild one segment only (debug)
 */
const args = process.argv.slice(2);
const segAt = args.indexOf("--seg");
if (segAt >= 0) {
  const id = args[segAt + 1];
  if (!id) throw new Error("--seg requires a scene id");
  console.log(buildOneSegment(PROMO, PROMO_OPTIONS, id));
} else {
  buildVideo(PROMO, PROMO_OPTIONS);
}
