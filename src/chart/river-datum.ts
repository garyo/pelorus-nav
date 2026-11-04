/**
 * The water levels river charts measure from. Inland ENCs record a cell's
 * datums as S-57 VERDAT codes, extended by the Inland ENC standard (31–43);
 * the pipeline stamps them on depth features (_sdat) and clearance features
 * (_vdat). A river datum is a reference level, not a tide: the river usually
 * stands above a low-water reference, so there is more water than charted
 * but less clearance under bridges and cables than charted.
 */

export interface RiverDatum {
  /** Short form for the chart-in-use readout. */
  short: string;
  /** Full name, as the Encoding Guide for Inland ENCs gives it. */
  name: string;
  /** A low-water reference: the river is usually above it. */
  lowWater: boolean;
}

const DATUMS: Record<number, RiverDatum> = {
  12: { short: "MLLW", name: "Mean lower low water", lowWater: true },
  31: {
    short: "Low water ref.",
    name: "Local low water reference level",
    lowWater: true,
  },
  32: {
    short: "High water ref.",
    name: "Local high water reference level",
    lowWater: false,
  },
  33: {
    short: "Mean water ref.",
    name: "Local mean water reference level",
    lowWater: false,
  },
  41: { short: "Ohio River Datum", name: "Ohio River Datum", lowWater: true },
};

/** The datum a VERDAT code names, or null when there is none. */
export function riverDatum(code: unknown): RiverDatum | null {
  if (code == null || code === "") return null;
  const n = Number(code);
  return (
    DATUMS[n] ?? { short: `Datum ${n}`, name: `Datum ${n}`, lowWater: false }
  );
}

/** What the river chart's datum means for depths and clearances. */
export function riverDatumExplanation(datum: RiverDatum): string {
  const measured = `Depths and clearances on this river chart are measured from the ${datum.name}, not a tidal datum.`;
  return datum.lowWater
    ? `${measured} The river usually stands above it: expect more water than charted, and less clearance under bridges and cables. Bridge notes give each bridge's own clearance reference.`
    : `${measured} Depths and clearances change with the river level.`;
}

/**
 * A clearance note that names its own reference level ("above 2% flowline",
 * "referenced to the Lowest Controlled Pool", "pool gage reading of 15.8'").
 * Many bridges' notes do, and theirs governs over the chart-wide datum.
 */
const OWN_REFERENCE =
  /flowline|pool|ga(?:u)?ge|datum|stage|elevation|referenced/i;

/** Pop-up rows naming the datums a river chart feature is measured from. */
export function riverDatumDetails(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const depths = riverDatum(props._sdat);
  if (depths) rows.push({ label: "Depths from", value: depths.name });
  const clearances = riverDatum(props._vdat);
  if (clearances) {
    if (OWN_REFERENCE.test(String(props.INFORM ?? ""))) {
      // The note above says what this clearance is measured from.
      rows.push({ label: "Chart default", value: clearances.name });
    } else {
      rows.push({ label: "Clearances from", value: clearances.name });
      if (clearances.lowWater) {
        rows.push({
          label: "Caution",
          value: "Less clearance when the river is above this level",
        });
      }
    }
  }
  return rows;
}
