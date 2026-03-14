/**
 * S-52 colour palette tokens.
 *
 * DAY, DUSK, NIGHT palettes sourced from openwatersio/enc-tiles colours.json
 * (IHO S-52 Presentation Library compliant).
 * EINK palette derived from DAY with greyscale conversions for e-ink displays.
 */

export type ColourScheme = "DAY" | "DUSK" | "NIGHT" | "EINK";

const DAY: Record<string, string> = {
  NODTA: "#93AEBB",
  CURSR: "#E38039",
  CHBLK: "#000000",
  CHGRD: "#4C5B63",
  CHGRF: "#768C97",
  CHRED: "#EA5471",
  CHGRN: "#52E83B",
  CHYLW: "#E1E139",
  CHMGD: "#C045D1",
  CHMGF: "#CBA9F9",
  CHBRN: "#A19653",
  CHWHT: "#C9EDFE",
  SCLBR: "#E38039",
  CHCOR: "#E38039",
  LITRD: "#EA5471",
  LITGN: "#52E83B",
  LITYW: "#E1E139",
  ISDNG: "#C045D1",
  DNGHL: "#EA5471",
  TRFCD: "#C045D1",
  TRFCF: "#CBA9F9",
  LANDA: "#BFBE8F",
  LANDF: "#8D642E",
  CSTLN: "#4C5B63",
  SNDG1: "#768C97",
  SNDG2: "#000000",
  DEPSC: "#4C5B63",
  DEPCN: "#768C97",
  DEPDW: "#C9EDFE",
  DEPMD: "#A7D9FB",
  DEPMS: "#82CAFF",
  DEPVS: "#61B7FF",
  DEPIT: "#58AF9C",
  RADHI: "#52E83B",
  RADLO: "#2F8E20",
  ARPAT: "#2DA879",
  NINFO: "#E38039",
  RESBL: "#2E7BFF",
  ADINF: "#A5A527",
  RESGR: "#768C97",
  SHIPS: "#000000",
  PSTRK: "#000000",
  SYTRK: "#768C97",
  PLRTE: "#D63F24",
  APLRT: "#E38039",
  UINFD: "#000000",
  UINFF: "#4C5B63",
  UIBCK: "#C9EDFE",
  UIAFD: "#61B7FF",
  UINFR: "#EA5471",
  UINFG: "#52E83B",
  UINFO: "#E38039",
  UINFB: "#2E7BFF",
  UINFM: "#C045D1",
  UIBDR: "#4C5B63",
  UIAFF: "#BFBE8F",
  OUTLW: "#000000",
  OUTLL: "#8D642E",
  RES01: "#768C97",
  RES02: "#768C97",
  RES03: "#768C97",
  BKAJ1: "#0E1315",
  BKAJ2: "#1C2327",
  MARBL: "#0080FF",
  MARCY: "#008F84",
  MARMG: "#C64DA6",
  MARWH: "#717F77",
  // Additional tokens used in nautical-style.ts
  APTS1: "#7777aa",
  PAYLC: "#8c6d4f",
};

const DUSK: Record<string, string> = {
  NODTA: "#404D53",
  CURSR: "#86491E",
  CHBLK: "#6B7F89",
  CHGRD: "#6B7F89",
  CHGRF: "#4C5B63",
  CHRED: "#9B3549",
  CHGRN: "#2F8E20",
  CHYLW: "#8B8B1F",
  CHMGD: "#826CA1",
  CHMGF: "#772782",
  CHBRN: "#57502A",
  CHWHT: "#8CA6B2",
  SCLBR: "#86491E",
  CHCOR: "#86491E",
  LITRD: "#9B3549",
  LITGN: "#2F8E20",
  LITYW: "#8B8B1F",
  ISDNG: "#826CA1",
  DNGHL: "#9B3549",
  TRFCD: "#826CA1",
  TRFCF: "#772782",
  LANDA: "#40402E",
  LANDF: "#7F5A29",
  CSTLN: "#6B7F89",
  SNDG1: "#4C5B63",
  SNDG2: "#8CA6B2",
  DEPSC: "#6B7F89",
  DEPCN: "#4C5B63",
  DEPDW: "#000000",
  DEPMD: "#0F1B21",
  DEPMS: "#1D3246",
  DEPVS: "#1E4165",
  DEPIT: "#234C44",
  RADHI: "#2F8E20",
  RADLO: "#195710",
  ARPAT: "#21825C",
  NINFO: "#86491E",
  RESBL: "#1D55B4",
  ADINF: "#646514",
  RESGR: "#6B7F89",
  SHIPS: "#8CA6B2",
  PSTRK: "#8CA6B2",
  SYTRK: "#4C5B63",
  PLRTE: "#952916",
  APLRT: "#86491E",
  UINFD: "#8CA6B2",
  UINFF: "#6B7F89",
  UIBCK: "#000000",
  UIAFD: "#1E4165",
  UINFR: "#9B3549",
  UINFG: "#2F8E20",
  UINFO: "#86491E",
  UINFB: "#1D55B4",
  UINFM: "#826CA1",
  UIBDR: "#6B7F89",
  UIAFF: "#7F5A29",
  OUTLW: "#000000",
  OUTLL: "#40402E",
  RES01: "#4C5B63",
  RES02: "#4C5B63",
  RES03: "#4C5B63",
  BKAJ1: "#000000",
  BKAJ2: "#101518",
  MARBL: "#0077F3",
  MARCY: "#00857A",
  MARMG: "#B8479A",
  MARWH: "#69766E",
  // Additional tokens
  APTS1: "#555577",
  PAYLC: "#5a4a3a",
};

const NIGHT: Record<string, string> = {
  NODTA: "#171E21",
  CURSR: "#301705",
  CHBLK: "#252D31",
  CHGRD: "#252D31",
  CHGRF: "#181E21",
  CHRED: "#390E16",
  CHGRN: "#0C3406",
  CHYLW: "#323206",
  CHMGD: "#411247",
  CHMGF: "#411247",
  CHBRN: "#211E0C",
  CHWHT: "#364147",
  SCLBR: "#301705",
  CHCOR: "#301705",
  LITRD: "#390E16",
  LITGN: "#0C3406",
  LITYW: "#323206",
  ISDNG: "#411247",
  DNGHL: "#390E16",
  TRFCD: "#411247",
  TRFCF: "#411247",
  LANDA: "#17160E",
  LANDF: "#2F1F0A",
  CSTLN: "#252D31",
  SNDG1: "#181E21",
  SNDG2: "#364147",
  DEPSC: "#252D31",
  DEPCN: "#181E21",
  DEPDW: "#000000",
  DEPMD: "#03070A",
  DEPMS: "#050E16",
  DEPVS: "#071727",
  DEPIT: "#0B201C",
  RADHI: "#0C3406",
  RADLO: "#041B02",
  ARPAT: "#052A1B",
  NINFO: "#301705",
  RESBL: "#051B44",
  ADINF: "#222203",
  RESGR: "#181E21",
  SHIPS: "#364147",
  PSTRK: "#364147",
  SYTRK: "#181E21",
  PLRTE: "#330803",
  APLRT: "#301705",
  UINFD: "#364147",
  UINFF: "#252D31",
  UIBCK: "#000000",
  UIAFD: "#071727",
  UINFR: "#390E16",
  UINFG: "#0C3406",
  UINFO: "#301705",
  UINFB: "#051B44",
  UINFM: "#411247",
  UIBDR: "#252D31",
  UIAFF: "#442E12",
  OUTLW: "#000000",
  OUTLL: "#17160E",
  RES01: "#181E21",
  RES02: "#181E21",
  RES03: "#181E21",
  BKAJ1: "#000000",
  BKAJ2: "#020304",
  MARBL: "#002655",
  MARCY: "#002B27",
  MARMG: "#3F1333",
  MARWH: "#202522",
  // Additional tokens
  APTS1: "#1a1a2a",
  PAYLC: "#1a150e",
};

/**
 * EINK palette: high-contrast for color e-ink displays (e.g. Bigme 7 Pro).
 * Background elements (water, land) stay greyscale for clarity.
 * Navigational colors (red/green buoys, lights) use vivid, saturated values
 * to compensate for the very muted color gamut of e-ink screens.
 */
const EINK: Record<string, string> = {
  NODTA: "#c0c0c0",
  CURSR: "#000000",
  CHBLK: "#000000",
  CHGRD: "#404040",
  CHGRF: "#707070",
  CHRED: "#aa0000", // vivid red — port buoys, dangers
  CHGRN: "#50ff00", // vivid green — starboard buoys
  CHYLW: "#ffff15", // vivid yellow — special buoys
  CHMGD: "#6600aa", // vivid magenta — magnetic variation
  CHMGF: "#909090",
  CHBRN: "#604020", // saturated brown — land contours
  CHWHT: "#f0f0f0",
  SCLBR: "#000000",
  CHCOR: "#000000",
  LITRD: "#aa0000", // vivid red — red light flares
  LITGN: "#50ff00", // vivid green — green light flares
  LITYW: "#ffff15", // vivid yellow — yellow lights
  ISDNG: "#aa0000", // danger — vivid red
  DNGHL: "#aa0000", // danger highlight — vivid red
  TRFCD: "#505050",
  TRFCF: "#a0a0a0",
  LANDA: "#b0b0b0",
  LANDF: "#202020", // land features (towers, chimneys) — near-black for e-ink
  CSTLN: "#000000",
  SNDG1: "#404040",
  SNDG2: "#000000",
  DEPSC: "#404040",
  DEPCN: "#707070",
  DEPDW: "#e0e0e0",
  DEPMD: "#d0d0d0",
  DEPMS: "#c8c8c8",
  DEPVS: "#b8b8b8",
  DEPIT: "#a0a0a0",
  RADHI: "#505050",
  RADLO: "#303030",
  ARPAT: "#404040",
  NINFO: "#000000",
  RESBL: "#0000aa", // restricted area — vivid blue
  ADINF: "#606060",
  RESGR: "#707070",
  SHIPS: "#000000",
  PSTRK: "#000000",
  SYTRK: "#707070",
  PLRTE: "#aa0000", // route line — vivid red
  APLRT: "#aa0000", // alert — vivid red
  UINFD: "#000000",
  UINFF: "#404040",
  UIBCK: "#ffffff",
  UIAFD: "#d0d0d0",
  UINFR: "#aa0000", // UI red
  UINFG: "#50ff00", // UI green
  UINFO: "#cc6600", // UI orange
  UINFB: "#0000aa", // UI blue
  UINFM: "#6600aa", // UI magenta
  UIBDR: "#000000",
  UIAFF: "#909090",
  OUTLW: "#000000",
  OUTLL: "#303030", // lighter outline — darkened for e-ink
  RES01: "#707070",
  RES02: "#707070",
  RES03: "#707070",
  BKAJ1: "#000000",
  BKAJ2: "#101010",
  MARBL: "#303030",
  MARCY: "#008888", // cyan marker — saturated
  MARMG: "#880088", // magenta marker — saturated
  MARWH: "#707070",
  // Additional tokens
  APTS1: "#606060",
  PAYLC: "#505050",
};

const PALETTES: Record<ColourScheme, Record<string, string>> = {
  DAY,
  DUSK,
  NIGHT,
  EINK,
};

/** The currently active colour scheme for style generation. */
let activeScheme: ColourScheme = "DAY";

/** Set the active colour scheme used by s52Colour(). */
export function setActiveColourScheme(scheme: ColourScheme): void {
  activeScheme = scheme;
}

/** Get the current active colour scheme. */
export function getActiveColourScheme(): ColourScheme {
  return activeScheme;
}

/**
 * Look up an S-52 colour token value.
 * Uses the active colour scheme set via setActiveColourScheme().
 * The optional scheme parameter overrides the active scheme for this call.
 */
export function s52Colour(token: string, scheme?: ColourScheme): string {
  const palette = PALETTES[scheme ?? activeScheme];
  const value = palette[token];
  if (value === undefined) {
    // Fall back to DAY palette if token not found in current scheme
    const dayValue = DAY[token];
    if (dayValue !== undefined) return dayValue;
    console.warn(`Unknown S-52 colour token: ${token}`);
    return "#ff00ff"; // magenta fallback
  }
  return value;
}
