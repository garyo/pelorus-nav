/**
 * Which hydrographic office produced the ENC charts on screen: NOAA for the
 * coast and the Great Lakes, the US Army Corps of Engineers for the inland
 * rivers (Inland ENCs). A region names its producer (tools/regions.json);
 * every chart feature also carries the S-57 producing-agency code (AGEN).
 */

export type EncProducer = "NOAA" | "USACE";

/** S-57 agency codes (IHO S-62) of the producers whose charts we serve. */
const AGENCY_CODES: Record<number, EncProducer> = {
  550: "NOAA",
  553: "USACE",
};

/** Producer named by an AGEN code, NOAA when the code is missing or unknown. */
export function encProducer(agen: unknown): EncProducer {
  return AGENCY_CODES[Number(agen)] ?? "NOAA";
}

/** Map attribution (HTML) for a producer's charts. */
export function encAttribution(producer: EncProducer): string {
  return producer === "USACE"
    ? '<a href="https://ienccloud.us">USACE</a> Inland ENC'
    : '&copy; <a href="https://nauticalcharts.noaa.gov">NOAA</a> ENC';
}
