/**
 * Short timezone abbreviation (e.g. "EDT", "PST", "GMT+1") for labeling local
 * times in popups. Uses the en-US locale so the familiar abbreviations appear
 * regardless of UI language. Defaults to the device's current zone; pass an
 * explicit IANA `timeZone` for testing or fixed-zone display.
 */
export function shortTimeZone(
  date: Date = new Date(),
  timeZone?: string,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}
