/**
 * S-52 colour palette tokens.
 *
 * DAY palette values sourced from IHO S-52 Presentation Library.
 * Only the tokens actually used in nautical-style.ts are included.
 */

const DAY: Record<string, string> = {
  // Water depths
  DEPVS: "#a0c8f0", // very shallow (< 5m)
  DEPMS: "#c4ddf5", // medium shallow (5-20m)
  DEPDW: "#d4e8f7", // deep water (> 20m)
  DEPIT: "#8cbc8c", // intertidal / drying

  // Land
  LANDA: "#f5e6c8", // land area
  LANDF: "#b5926b", // land feature / building

  // Chart symbols
  CHBLK: "#333333", // chart black (coastline, text)
  CSTLN: "#333333", // coastline
  CHGRD: "#6a9fc0", // chart grid / depth contours
  CHBRN: "#664422", // chart brown (bridges)
  CHGRF: "#555555", // chart grey-fill (structures)

  // Water features
  LITRD: "#cc0000", // red light
  LITGN: "#00cc00", // green light
  LITYW: "#ffcc00", // yellow light / glow
  ISDNG: "#888888", // cables, misc grey

  // Regulatory / restricted
  RESBL: "#9933cc", // restricted area (anchoring)
  TRFCD: "#cc33aa", // traffic separation
  CHMGD: "#dd6600", // restricted area
  CHMGF: "#ddaa00", // caution area

  // Misc
  NODTA: "#cccccc", // no data / unsurveyed
  RADHI: "#8899aa", // dredged area outline
  APTS1: "#7777aa", // fairway outline

  SNDG1: "#333333", // sounding text
  SNDG2: "#996600", // light label text
  NINFO: "#5a4a32", // land label text
  BKAJ1: "#3a6a3a", // sea area label text

  DEPMD: "#a8ccee", // lake/river fill
  PAYLC: "#8c6d4f", // building outline

  OUTLW: "#cc4400", // overhead cable
};

type ColourScheme = "DAY" | "DUSK" | "NIGHT";

/**
 * Look up an S-52 colour token value.
 * Currently only DAY palette is implemented; DUSK/NIGHT return DAY values.
 */
export function s52Colour(
  token: string,
  _scheme: ColourScheme = "DAY",
): string {
  const value = DAY[token];
  if (value === undefined) {
    console.warn(`Unknown S-52 colour token: ${token}`);
    return "#ff00ff"; // magenta fallback
  }
  return value;
}
