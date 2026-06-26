/**
 * S-57 test-chart catalog: a synthetic feature for (nearly) every S-57 object
 * class the pipeline processes, in as many variants as practical — geometry
 * primitive (point/line/area), labeled/unlabeled, and key attribute variations
 * that drive iconography (buoy shape, light characteristic, wreck category, …).
 *
 * Single source of truth, consumed by:
 *   - generate.ts        → per-layer GeoJSON + test-chart.pmtiles (rendering)
 *   - the coverage tests  → drives formatFeatureInfo() for click output
 *
 * The class list mirrors tools/s57-pipeline/s57_pipeline/layers.py exactly.
 */

export type Geom = "Point" | "LineString" | "Polygon";

export interface Variant {
  /** Stable id, e.g. "BOYLAT__port-can__labeled". */
  id: string;
  cls: string;
  geometry: Geom;
  labeled: boolean;
  /** S-57 attributes as they appear in flattened MVT tiles (no arrays). */
  properties: Record<string, unknown>;
}

/** A class spec: allowed geometries + attribute profiles (variants pre-label). */
interface Spec {
  cls: string;
  geoms: Geom[];
  /** Named attribute profiles. Each becomes labeled + unlabeled variants. */
  profiles: { name: string; props: Record<string, unknown> }[];
}

/** Shorthand: one default profile with the given props. */
const one = (props: Record<string, unknown>) => [{ name: "default", props }];

/**
 * The catalog. Geometry lists reflect what the styles/clickable layers handle
 * (e.g. OBSTRN as point/line/area, LNDARE as area+point). Attribute profiles
 * focus on what drives icon selection and the click formatter.
 */
const SPECS: Spec[] = [
  // ── Depth / terrain areas ────────────────────────────────────────────────
  {
    cls: "DEPARE",
    geoms: ["Polygon"],
    profiles: [
      { name: "drying", props: { DRVAL1: -1.5, DRVAL2: 0 } },
      { name: "shallow", props: { DRVAL1: 0, DRVAL2: 5 } },
      { name: "medium", props: { DRVAL1: 5, DRVAL2: 10 } },
      { name: "deep", props: { DRVAL1: 20, DRVAL2: 50 } },
    ],
  },
  {
    cls: "LNDARE",
    geoms: ["Polygon", "Point"],
    profiles: one({ OBJNAM: "Test Island" }),
  },
  {
    cls: "SEAARE",
    geoms: ["Polygon"],
    profiles: one({ OBJNAM: "Test Bay", CATSEA: 8 }),
  },
  { cls: "LAKARE", geoms: ["Polygon"], profiles: one({ OBJNAM: "Test Lake" }) },
  {
    cls: "RIVERS",
    geoms: ["Polygon", "LineString"],
    profiles: one({ OBJNAM: "Test River" }),
  },
  {
    cls: "DRGARE",
    geoms: ["Polygon"],
    profiles: one({ DRVAL1: 8, RESTRN: 8 }),
  },
  { cls: "UNSARE", geoms: ["Polygon"], profiles: one({}) },
  {
    cls: "VEGATN",
    geoms: ["Polygon", "Point"],
    profiles: one({ CATVEG: 16, OBJNAM: "Marsh" }),
  },

  // ── Lines ────────────────────────────────────────────────────────────────
  {
    cls: "DEPCNT",
    geoms: ["LineString"],
    profiles: [
      { name: "2m", props: { VALDCO: 2 } },
      { name: "10m", props: { VALDCO: 10 } },
    ],
  },
  { cls: "COALNE", geoms: ["LineString"], profiles: one({ CATCOA: 6 }) },
  {
    cls: "SLCONS",
    geoms: ["LineString"],
    profiles: [
      { name: "breakwater", props: { CATSLC: 4, OBJNAM: "Breakwater" } },
      { name: "submerged", props: { CATSLC: 4, WATLEV: 3 } },
    ],
  },
  { cls: "DYKCON", geoms: ["LineString"], profiles: one({ OBJNAM: "Dyke" }) },
  { cls: "SLOTOP", geoms: ["LineString"], profiles: one({ CATSLO: 6 }) },
  { cls: "SLOGRD", geoms: ["LineString"], profiles: one({}) },

  // ── Lateral / cardinal / special buoys ──────────────────────────────────
  {
    cls: "BOYLAT",
    geoms: ["Point"],
    profiles: [
      {
        name: "port-can-red",
        props: {
          CATLAM: 1,
          BOYSHP: 2,
          COLOUR: "3",
          OBJNAM: "Buoy 1",
          LABEL: "1",
        },
      },
      {
        name: "stbd-cone-green",
        props: {
          CATLAM: 2,
          BOYSHP: 1,
          COLOUR: "4",
          OBJNAM: "Buoy 2",
          LABEL: "2",
        },
      },
      {
        name: "pref-chan-stbd",
        props: { CATLAM: 3, BOYSHP: 4, COLOUR: "3,4,3", LABEL: "PC" },
      },
    ],
  },
  {
    cls: "BOYCAR",
    geoms: ["Point"],
    profiles: [
      {
        name: "north",
        props: {
          CATCAM: 1,
          BOYSHP: 5,
          COLOUR: "2,6",
          HAS_TOPMAR: 1,
          LABEL: "N",
        },
      },
      {
        name: "south",
        props: {
          CATCAM: 2,
          BOYSHP: 5,
          COLOUR: "6,2",
          HAS_TOPMAR: 1,
          LABEL: "S",
        },
      },
    ],
  },
  {
    cls: "BOYSAW",
    geoms: ["Point"],
    profiles: one({ BOYSHP: 4, COLOUR: "3,9", OBJNAM: "Fairway", LABEL: "SW" }),
  },
  {
    cls: "BOYSPP",
    geoms: ["Point"],
    profiles: one({ BOYSHP: 2, COLOUR: "6", CATSPM: "29", OBJNAM: "Special" }),
  },
  {
    cls: "BOYISD",
    geoms: ["Point"],
    profiles: one({
      BOYSHP: 4,
      COLOUR: "2,3,2",
      HAS_TOPMAR: 1,
      OBJNAM: "Iso Danger",
    }),
  },
  {
    cls: "BOYINB",
    geoms: ["Point"],
    profiles: one({ BOYSHP: 7, COLOUR: "6", CATINB: 1 }),
  },

  // ── Beacons ──────────────────────────────────────────────────────────────
  {
    cls: "BCNLAT",
    geoms: ["Point"],
    profiles: [
      {
        name: "port",
        props: { CATLAM: 1, BCNSHP: 1, COLOUR: "3", OBJNAM: "Beacon Port" },
      },
      {
        name: "stbd",
        props: { CATLAM: 2, BCNSHP: 1, COLOUR: "4", OBJNAM: "Beacon Stbd" },
      },
    ],
  },
  {
    cls: "BCNCAR",
    geoms: ["Point"],
    profiles: one({ CATCAM: 3, BCNSHP: 3, COLOUR: "2,6,2", HAS_TOPMAR: 1 }),
  },
  {
    cls: "BCNISD",
    geoms: ["Point"],
    profiles: one({ BCNSHP: 3, COLOUR: "2,3,2", HAS_TOPMAR: 1 }),
  },
  {
    cls: "BCNSAW",
    geoms: ["Point"],
    profiles: one({ BCNSHP: 3, COLOUR: "3,9" }),
  },
  {
    cls: "BCNSPP",
    geoms: ["Point"],
    profiles: one({ BCNSHP: 1, COLOUR: "6", CATSPM: "30", OBJNAM: "Marker" }),
  },

  // ── Lights / fog / day marks ─────────────────────────────────────────────
  {
    cls: "LIGHTS",
    geoms: ["Point"],
    profiles: [
      {
        name: "major-fl-w",
        props: {
          LITCHR: 2,
          COLOUR: "1",
          SIGGRP: "(1)",
          SIGPER: 4,
          VALNMR: 18,
          HEIGHT: 25,
          OBJNAM: "Lighthouse",
          LABEL: "Fl W 4s 25m 18M",
        },
      },
      {
        name: "sectored-r",
        props: {
          LITCHR: 4,
          COLOUR: "3",
          SIGGRP: "(3)",
          SIGPER: 10,
          SECTR1: 270,
          SECTR2: 90,
          LABEL: "Q(3)R 10s",
        },
      },
    ],
  },
  {
    cls: "FOGSIG",
    geoms: ["Point"],
    profiles: one({ CATFOG: 1, SIGGRP: "(2)", SIGPER: 30, OBJNAM: "Horn" }),
  },
  {
    cls: "DAYMAR",
    geoms: ["Point"],
    profiles: one({ CATSPM: "30", COLOUR: "3", TOPSHP: 1 }),
  },
  {
    cls: "TOPMAR",
    geoms: ["Point"],
    profiles: one({ TOPSHP: 2, COLOUR: "3" }),
  },
  {
    cls: "LITFLT",
    geoms: ["Point"],
    profiles: one({ COLOUR: "3", OBJNAM: "Light Float" }),
  },
  {
    cls: "LITVES",
    geoms: ["Point"],
    profiles: one({ COLOUR: "3", OBJNAM: "Lightship Nantucket" }),
  },
  { cls: "RETRFL", geoms: ["Point"], profiles: one({ COLOUR: "5" }) },

  // ── Hazards ──────────────────────────────────────────────────────────────
  {
    cls: "WRECKS",
    geoms: ["Point", "Polygon"],
    profiles: [
      {
        name: "dangerous",
        props: { CATWRK: 2, WATLEV: 3, VALSOU: 4.5, OBJNAM: "Wreck" },
      },
      { name: "mast-showing", props: { CATWRK: 5, WATLEV: 4 } },
    ],
  },
  {
    cls: "OBSTRN",
    geoms: ["Point", "LineString", "Polygon"],
    profiles: [
      { name: "submerged", props: { CATOBS: 6, WATLEV: 3, VALSOU: 2.1 } },
      { name: "foul-ground", props: { CATOBS: 7, WATLEV: 3 } },
    ],
  },
  {
    cls: "UWTROC",
    geoms: ["Point"],
    profiles: [
      { name: "awash", props: { WATLEV: 4, VALSOU: 0 } },
      { name: "submerged", props: { WATLEV: 3, VALSOU: 1.8 } },
    ],
  },
  {
    cls: "ROCKAL",
    geoms: ["Point"],
    profiles: one({ WATLEV: 2, OBJNAM: "Rock" }),
  },
  { cls: "WATTUR", geoms: ["Point", "Polygon"], profiles: one({ CATWAT: 4 }) },
  { cls: "OVFALL", geoms: ["Point"], profiles: one({}) },
  { cls: "SNDWAV", geoms: ["Point"], profiles: one({}) },
  { cls: "SPRING", geoms: ["Point"], profiles: one({ OBJNAM: "Spring" }) },
  { cls: "SWPARE", geoms: ["Polygon"], profiles: one({ DRVAL1: 12 }) },
  {
    cls: "FSHFAC",
    geoms: ["Point", "LineString"],
    profiles: one({ CATFIF: 3, OBJNAM: "Fish Trap" }),
  },
  {
    cls: "MARCUL",
    geoms: ["Polygon"],
    profiles: one({ CATMFA: 1, OBJNAM: "Oyster Beds" }),
  },
  { cls: "WEDKLP", geoms: ["Point", "Polygon"], profiles: one({ CATWED: 1 }) },
  {
    cls: "HULKES",
    geoms: ["Point", "Polygon"],
    profiles: one({ OBJNAM: "Hulk" }),
  },

  // ── Soundings ────────────────────────────────────────────────────────────
  {
    cls: "SOUNDG",
    geoms: ["Point"],
    profiles: [
      { name: "shoal", props: { DEPTH: 2.4 } },
      { name: "deep", props: { DEPTH: 18.3 } },
    ],
  },
  {
    cls: "SBDARE",
    geoms: ["Point"],
    profiles: one({ NATSUR: 4, OBJNAM: "Sand" }),
  },
  {
    cls: "MAGVAR",
    geoms: ["Point"],
    profiles: one({ VALMAG: -14.5, RYRMGV: 2020, VALACM: 0.1 }),
  },

  // ── Landmarks / land features ────────────────────────────────────────────
  {
    cls: "LNDMRK",
    geoms: ["Point"],
    profiles: [
      {
        name: "tower-conspic",
        props: { CATLMK: 17, CONVIS: 1, OBJNAM: "Water Tower" },
      },
      { name: "chimney", props: { CATLMK: 3, OBJNAM: "Chimney" } },
      { name: "monument", props: { CATLMK: 9, OBJNAM: "Monument" } },
    ],
  },
  { cls: "LNDRGN", geoms: ["Point"], profiles: one({ OBJNAM: "Cape Cod" }) },
  {
    cls: "LNDELV",
    geoms: ["Point"],
    profiles: one({ ELEVAT: 120, OBJNAM: "Hill" }),
  },
  {
    cls: "BUAARE",
    geoms: ["Polygon", "Point"],
    profiles: one({ OBJNAM: "Townsville", CATBUA: 1 }),
  },

  // ── Infrastructure ───────────────────────────────────────────────────────
  {
    cls: "SMCFAC",
    geoms: ["Point"],
    profiles: one({ CATSCF: "14,7,26", OBJNAM: "Marina" }),
  },
  {
    cls: "BUISGL",
    geoms: ["Point", "Polygon"],
    profiles: one({ FUNCTN: 33, OBJNAM: "Custom House" }),
  },
  { cls: "BERTHS", geoms: ["Point"], profiles: one({ OBJNAM: "Berth 7" }) },
  { cls: "PILPNT", geoms: ["Point"], profiles: one({ CATPLE: 3 }) },
  {
    cls: "PYLONS",
    geoms: ["Point"],
    profiles: one({ CATPYL: 1, OBJNAM: "Pylon" }),
  },
  {
    cls: "BRIDGE",
    geoms: ["LineString"],
    profiles: [
      {
        name: "bascule",
        props: { CATBRG: 5, VERCLR: 12, OBJNAM: "Drawbridge" },
      },
      { name: "fixed", props: { CATBRG: 1, VERCLR: 25, HORCLR: 100 } },
    ],
  },
  {
    cls: "CBLOHD",
    geoms: ["LineString"],
    profiles: one({ CATCBL: 1, VERCLR: 18 }),
  },
  { cls: "CBLSUB", geoms: ["LineString"], profiles: one({ CATCBL: 1 }) },
  {
    cls: "CBLARE",
    geoms: ["Polygon"],
    profiles: one({ CATCBL: 1, RESTRN: 1 }),
  },
  {
    cls: "MORFAC",
    geoms: ["Point"],
    profiles: one({ CATMOR: 7, OBJNAM: "Mooring" }),
  },
  {
    cls: "PONTON",
    geoms: ["LineString", "Polygon"],
    profiles: one({ OBJNAM: "Pontoon" }),
  },
  {
    cls: "HRBFAC",
    geoms: ["Point"],
    profiles: one({ CATHAF: "5", OBJNAM: "Harbor" }),
  },
  {
    cls: "OFSPLF",
    geoms: ["Point"],
    profiles: one({ CATOFP: 1, CONVIS: 1, OBJNAM: "Platform A" }),
  },
  {
    cls: "SILTNK",
    geoms: ["Point", "Polygon"],
    profiles: one({ CATSIL: 1, CONVIS: 1, OBJNAM: "Silo" }),
  },
  {
    cls: "GATCON",
    geoms: ["Point", "LineString"],
    profiles: one({ CATGAT: 3, OBJNAM: "Lock Gate" }),
  },
  {
    cls: "DAMCON",
    geoms: ["Point", "LineString"],
    profiles: one({ CATDAM: 2, OBJNAM: "Dam" }),
  },
  {
    cls: "TUNNEL",
    geoms: ["Point", "LineString"],
    profiles: one({ VERCLR: 4, OBJNAM: "Tunnel" }),
  },
  {
    cls: "CANALS",
    geoms: ["LineString", "Polygon"],
    profiles: one({ CATCAN: 1, OBJNAM: "Canal" }),
  },
  {
    cls: "CRANES",
    geoms: ["Point"],
    profiles: one({ CATCRN: 2, OBJNAM: "Crane" }),
  },
  {
    cls: "FORSTC",
    geoms: ["Point", "Polygon"],
    profiles: one({ CATFOR: 1, CONVIS: 1, OBJNAM: "Fort" }),
  },
  { cls: "CGUSTA", geoms: ["Point"], profiles: one({ OBJNAM: "Coast Guard" }) },
  {
    cls: "DRYDOC",
    geoms: ["Point", "Polygon"],
    profiles: one({ OBJNAM: "Dry Dock" }),
  },
  {
    cls: "FLODOC",
    geoms: ["Point", "Polygon"],
    profiles: one({ OBJNAM: "Floating Dock" }),
  },
  {
    cls: "RUNWAY",
    geoms: ["Point", "Polygon"],
    profiles: one({ CATRUN: 1, OBJNAM: "Runway 09" }),
  },
  {
    cls: "AIRARE",
    geoms: ["Point", "Polygon"],
    profiles: one({ OBJNAM: "Airport" }),
  },
  {
    cls: "PIPOHD",
    geoms: ["LineString"],
    profiles: one({ CATPIP: 2, VERCLR: 6 }),
  },
  {
    cls: "PIPSOL",
    geoms: ["LineString"],
    profiles: one({ CATPIP: 2, PRODCT: "1" }),
  },
  {
    cls: "PIPARE",
    geoms: ["Polygon"],
    profiles: one({ CATPIP: 2, RESTRN: 1 }),
  },

  // ── Routing / regulatory ─────────────────────────────────────────────────
  {
    cls: "TSSLPT",
    geoms: ["Polygon"],
    profiles: one({ ORIENT: 45, CATTSS: 1 }),
  },
  { cls: "TSSBND", geoms: ["LineString"], profiles: one({}) },
  { cls: "TSEZNE", geoms: ["Polygon"], profiles: one({}) },
  { cls: "TSSRON", geoms: ["Polygon"], profiles: one({}) },
  { cls: "TWRTPT", geoms: ["Polygon"], profiles: one({ ORIENT: 90 }) },
  { cls: "ISTZNE", geoms: ["Polygon"], profiles: one({}) },
  {
    cls: "FAIRWY",
    geoms: ["Polygon"],
    profiles: one({ OBJNAM: "Main Channel", ORIENT: 30 }),
  },
  {
    cls: "NAVLNE",
    geoms: ["LineString"],
    profiles: one({ ORIENT: 145, OBJNAM: "Leading Line" }),
  },
  {
    cls: "RECTRC",
    geoms: ["LineString"],
    profiles: one({ ORIENT: 145, CATTRK: 1, OBJNAM: "Recommended Track" }),
  },
  { cls: "DWRTCL", geoms: ["LineString"], profiles: one({ ORIENT: 200 }) },
  {
    cls: "RESARE",
    geoms: ["Polygon"],
    profiles: [
      {
        name: "no-anchor",
        props: { CATREA: "14", RESTRN: "1", OBJNAM: "No Anchoring" },
      },
      { name: "nature", props: { CATREA: "4", OBJNAM: "Nature Reserve" } },
    ],
  },
  {
    cls: "ACHARE",
    geoms: ["Polygon"],
    profiles: one({ CATACH: "1", OBJNAM: "Anchorage A" }),
  },
  {
    cls: "ACHBRT",
    geoms: ["Polygon", "Point"],
    profiles: one({ OBJNAM: "A3", RADIUS: 50 }),
  },
  {
    cls: "CTNARE",
    geoms: ["Polygon", "Point"],
    profiles: one({ OBJNAM: "Caution" }),
  },
  {
    cls: "PRCARE",
    geoms: ["Polygon", "Point"],
    profiles: one({ OBJNAM: "Precautionary" }),
  },
  { cls: "DMPGRD", geoms: ["Polygon"], profiles: one({ CATDPG: 1 }) },
  {
    cls: "MIPARE",
    geoms: ["Polygon"],
    profiles: one({ CATMPA: 2, RESTRN: "7", OBJNAM: "Military Area" }),
  },
  {
    cls: "OSPARE",
    geoms: ["Polygon"],
    profiles: one({ CATPRA: 4, OBJNAM: "Production Area" }),
  },
  {
    cls: "SPLARE",
    geoms: ["Polygon"],
    profiles: one({ OBJNAM: "Spoil Ground" }),
  },
  {
    cls: "DGRARE",
    geoms: ["Polygon"],
    profiles: one({ OBJNAM: "Danger Area" }),
  },
  {
    cls: "TESARE",
    geoms: ["Polygon"],
    profiles: one({ OBJNAM: "Territorial Sea" }),
  },
  {
    cls: "EXEZNE",
    geoms: ["Polygon"],
    profiles: one({ CATEXS: 4, OBJNAM: "Exclusive Zone" }),
  },
  {
    cls: "FERYRT",
    geoms: ["LineString"],
    profiles: one({ CATFRY: 1, OBJNAM: "Ferry" }),
  },
  {
    cls: "PILBOP",
    geoms: ["Point", "LineString"],
    profiles: one({ CATPIL: 1, OBJNAM: "Pilot Boarding" }),
  },

  // ── Radio / signal stations ──────────────────────────────────────────────
  {
    cls: "RDOSTA",
    geoms: ["Point"],
    profiles: one({ CATROS: "3", OBJNAM: "Radio Station" }),
  },
  {
    cls: "RTPBCN",
    geoms: ["Point"],
    profiles: one({ CATRTB: 1, OBJNAM: "Racon" }),
  },
  {
    cls: "RDOCAL",
    geoms: ["Point"],
    profiles: [
      // one-way traffic → RDOCAL02, rotated by ORIENT
      {
        name: "one-way",
        props: {
          OBJNAM: "Calling-in Point",
          TRAFIC: 3,
          ORIENT: 90,
          COMCHA: "16",
        },
      },
      // two-way traffic → RDOCAL03, rotated by ORIENT
      {
        name: "two-way",
        props: { OBJNAM: "Two-way Point", TRAFIC: 4, ORIENT: 45 },
      },
      // direction unknown (no TRAFIC) → RCLDEF01
      { name: "default", props: { OBJNAM: "Reporting Point" } },
    ],
  },
  {
    cls: "RSCSTA",
    geoms: ["Point"],
    profiles: one({ CATRSC: "1", OBJNAM: "Rescue Station" }),
  },
  {
    cls: "SISTAT",
    geoms: ["Point"],
    profiles: one({ CATSIT: "4", OBJNAM: "Signal Station" }),
  },
  {
    cls: "CURENT",
    geoms: ["Point"],
    profiles: one({ ORIENT: 270, CURVEL: 2.5 }),
  },
  {
    cls: "NEWOBJ",
    geoms: ["Point", "LineString", "Polygon"],
    profiles: one({ OBJNAM: "Uncharted" }),
  },
];

/** Expand the catalog into concrete variants, one labeled + one unlabeled each
 * (unlabeled only differs when the profile carries OBJNAM). */
export function buildVariants(): Variant[] {
  const out: Variant[] = [];
  for (const spec of SPECS) {
    for (const geom of spec.geoms) {
      for (const profile of spec.profiles) {
        const hasName = "OBJNAM" in profile.props;
        const labelStates = hasName ? [true, false] : [true];
        for (const labeled of labelStates) {
          const props = { ...profile.props };
          if (!labeled) delete props.OBJNAM;
          const geomTag =
            spec.geoms.length > 1 ? `__${geom.toLowerCase()}` : "";
          const labTag = hasName ? (labeled ? "__labeled" : "__unlabeled") : "";
          out.push({
            id: `${spec.cls}__${profile.name}${geomTag}${labTag}`,
            cls: spec.cls,
            geometry: geom,
            labeled,
            properties: props,
          });
        }
      }
    }
  }
  return out;
}

/** Every S-57 class in the catalog. */
export const CATALOG_CLASSES: string[] = SPECS.map((s) => s.cls);
