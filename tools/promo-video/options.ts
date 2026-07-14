import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderOptions } from "../tutorial-gen/index";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Engine options for the Pelorus promo. Everything else (capture 1280x720@2x,
 * delivery 1920x1080@30, CRF 12/14, 3.5s preroll) is the engine default —
 * matching the values the finished v2 cut was built with.
 */
export const PROMO_OPTIONS: RenderOptions = {
  root: HERE,
  out: join(HERE, "out", "pelorus-promo-v2.mp4"),
};
