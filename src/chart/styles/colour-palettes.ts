/**
 * Re-export colour palette utilities from s52-colours.ts.
 * The palettes themselves stay in s52-colours.ts; this module
 * provides a convenient import path from the styles directory.
 */
export {
  type ColourScheme,
  getActiveColourScheme,
  s52Colour,
  setActiveColourScheme,
} from "../s52-colours";
