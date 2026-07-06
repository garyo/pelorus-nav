/**
 * GPX 1.1 serialization and parsing for routes, tracks, and waypoints.
 * Pure functions — no DOM or DB dependencies (except DOMParser for import).
 */

import { generateUUID } from "../utils/uuid";
import type { Route, Waypoint } from "./Route";
import type { TrackMeta, TrackPoint } from "./Track";
import type { StandaloneWaypoint, WaypointIcon } from "./Waypoint";

const GPX_NS = "http://www.topografix.com/GPX/1/1";
const PELORUS_NS = "https://pelorus-nav.app/gpx/1";

/** Emit per-point raw lat/lon as Pelorus extensions when a track has been
 *  smoothed. Useful while debugging the post-processor; off for normal
 *  exports so the file stays compact. The import side still parses these
 *  if present, so flipping this back on is a one-line change. */
const EMIT_RAW_TRACK_POINTS = false;

// Default color palette for imported items without color info
const IMPORT_COLORS = [
  "#4488cc",
  "#cc4444",
  "#44aa44",
  "#cc8844",
  "#8844cc",
  "#44cccc",
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gpxHeader(name: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Pelorus Nav"\n` +
    `     xmlns="${GPX_NS}"\n` +
    `     xmlns:pelorus="${PELORUS_NS}">\n` +
    `  <metadata>\n` +
    `    <name>${escapeXml(name)}</name>\n` +
    `    <time>${new Date().toISOString()}</time>\n` +
    `  </metadata>\n`
  );
}

const GPX_FOOTER = "</gpx>\n";

function waypointXml(wp: Waypoint, indent: string): string {
  let xml = `${indent}<rtept lat="${wp.lat}" lon="${wp.lon}">\n`;
  if (wp.name) {
    xml += `${indent}  <name>${escapeXml(wp.name)}</name>\n`;
  }
  xml += `${indent}</rtept>\n`;
  return xml;
}

function standaloneWaypointXml(wp: StandaloneWaypoint): string {
  let xml = `  <wpt lat="${wp.lat}" lon="${wp.lon}">\n`;
  if (wp.name) {
    xml += `    <name>${escapeXml(wp.name)}</name>\n`;
  }
  if (wp.notes) {
    xml += `    <desc>${escapeXml(wp.notes)}</desc>\n`;
  }
  if (wp.icon && wp.icon !== "default") {
    xml += `    <sym>${escapeXml(wp.icon)}</sym>\n`;
  }
  xml += "  </wpt>\n";
  return xml;
}

function routeXml(route: Route): string {
  let xml = "  <rte>\n";
  xml += `    <name>${escapeXml(route.name)}</name>\n`;
  if (route.color) {
    xml += `    <extensions>\n`;
    xml += `      <pelorus:color>${escapeXml(route.color)}</pelorus:color>\n`;
    xml += `    </extensions>\n`;
  }
  for (const wp of route.waypoints) {
    xml += waypointXml(wp, "    ");
  }
  xml += "  </rte>\n";
  return xml;
}

function trackPointXml(pt: TrackPoint): string {
  let xml = `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
  if (pt.timestamp) {
    xml += `        <time>${new Date(pt.timestamp).toISOString()}</time>\n`;
  }
  const emitRaw =
    EMIT_RAW_TRACK_POINTS && pt.rawLat !== undefined && pt.rawLon !== undefined;
  const hasAccuracy = pt.accuracy !== null && pt.accuracy !== undefined;
  if (pt.sog !== null || pt.cog !== null || hasAccuracy || emitRaw) {
    xml += "        <extensions>\n";
    if (pt.sog !== null) {
      xml += `          <pelorus:sog>${pt.sog}</pelorus:sog>\n`;
    }
    if (pt.cog !== null) {
      xml += `          <pelorus:cog>${pt.cog}</pelorus:cog>\n`;
    }
    if (hasAccuracy) {
      xml += `          <pelorus:accuracy>${pt.accuracy}</pelorus:accuracy>\n`;
    }
    if (emitRaw) {
      xml += `          <pelorus:lat-raw>${pt.rawLat}</pelorus:lat-raw>\n`;
      xml += `          <pelorus:lon-raw>${pt.rawLon}</pelorus:lon-raw>\n`;
    }
    xml += "        </extensions>\n";
  }
  xml += "      </trkpt>\n";
  return xml;
}

function trackXml(meta: TrackMeta, points: TrackPoint[]): string {
  let xml = "  <trk>\n";
  xml += `    <name>${escapeXml(meta.name)}</name>\n`;
  if (meta.color) {
    xml += `    <extensions>\n`;
    xml += `      <pelorus:color>${escapeXml(meta.color)}</pelorus:color>\n`;
    xml += `    </extensions>\n`;
  }
  xml += "    <trkseg>\n";
  for (const pt of points) {
    // Outliers flagged by the post-processor are kept in IDB for debug
    // but excluded from exports — the polyline reads cleaner without
    // them, and downstream tools shouldn't have to know about our flag.
    if (pt.dropped) continue;
    xml += trackPointXml(pt);
  }
  xml += "    </trkseg>\n";
  xml += "  </trk>\n";
  return xml;
}

/** Serialize a single route to a complete GPX XML string. */
export function routeToGpx(route: Route): string {
  return gpxHeader(route.name) + routeXml(route) + GPX_FOOTER;
}

/** Serialize a single track (with loaded points) to GPX. */
export function trackToGpx(meta: TrackMeta, points: TrackPoint[]): string {
  return gpxHeader(meta.name) + trackXml(meta, points) + GPX_FOOTER;
}

/** Serialize standalone waypoints to GPX. */
export function waypointsToGpx(waypoints: StandaloneWaypoint[]): string {
  let xml = gpxHeader("Waypoints");
  for (const wp of waypoints) {
    xml += standaloneWaypointXml(wp);
  }
  xml += GPX_FOOTER;
  return xml;
}

/** Serialize everything into one GPX file. */
export function exportAllToGpx(
  routes: Route[],
  tracks: Array<{ meta: TrackMeta; points: TrackPoint[] }>,
  waypoints: StandaloneWaypoint[],
): string {
  let xml = gpxHeader("Pelorus Nav Export");
  for (const wp of waypoints) {
    xml += standaloneWaypointXml(wp);
  }
  for (const route of routes) {
    xml += routeXml(route);
  }
  for (const { meta, points } of tracks) {
    xml += trackXml(meta, points);
  }
  xml += GPX_FOOTER;
  return xml;
}

// ── Import ──────────────────────────────────────────────────────────

export interface GpxImportResult {
  routes: Route[];
  tracks: Array<{ meta: TrackMeta; points: TrackPoint[] }>;
  waypoints: StandaloneWaypoint[];
  /** Points/waypoints dropped for missing or out-of-range lat/lon. */
  skippedPoints: number;
}

/**
 * Parse and validate a coordinate attribute. Returns null (rather than
 * defaulting to "0") when the attribute is missing, non-numeric, or outside
 * its valid range — a missing lat/lon should never silently become
 * null-island, and a malformed one should never become NaN.
 */
function parseCoordAttr(
  value: string | null,
  min: number,
  max: number,
): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function parseLatLon(el: Element): { lat: number; lon: number } | null {
  const lat = parseCoordAttr(el.getAttribute("lat"), -90, 90);
  const lon = parseCoordAttr(el.getAttribute("lon"), -180, 180);
  if (lat === null || lon === null) return null;
  return { lat, lon };
}

/**
 * Get text content of a *direct* child element by local name (namespaced or
 * bare — `Element.localName` ignores the prefix either way). Direct children
 * only: a descendant search would find e.g. a `<rtept><name>` nested inside
 * an `<rte>` that has no `<name>` of its own, and misreport it as the
 * route's name.
 */
function childText(parent: Element, localName: string): string | null {
  const el = Array.from(parent.children).find((c) => c.localName === localName);
  if (el?.textContent) return el.textContent.trim();
  return null;
}

/** Get text from a Pelorus extension element. */
function pelorusExt(parent: Element, localName: string): string | null {
  const el = parent.getElementsByTagNameNS(PELORUS_NS, localName)[0];
  if (el?.textContent) return el.textContent.trim();
  // Fall back to bare prefixed name
  const bare = parent.getElementsByTagName(`pelorus:${localName}`)[0];
  if (bare?.textContent) return bare.textContent.trim();
  return null;
}

/** Get *direct* child elements matching a local name (see `childText`). */
function getElements(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === localName);
}

function parseColor(el: Element, fallbackIndex: number): string {
  const color = pelorusExt(el, "color");
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return IMPORT_COLORS[fallbackIndex % IMPORT_COLORS.length];
}

function parseWaypointIcon(sym: string | null): WaypointIcon {
  if (!sym) return "default";
  const lower = sym.toLowerCase();
  if (lower === "anchorage" || lower === "anchor") return "anchorage";
  if (lower === "hazard" || lower === "danger") return "hazard";
  if (lower === "fuel" || lower === "gas station") return "fuel";
  if (lower === "poi" || lower === "flag") return "poi";
  if (lower === "cob" || lower === "mob" || lower === "man overboard")
    return "cob";
  return "default";
}

/** Parse a GPX XML string into app data structures. New UUIDs are assigned. */
export function parseGpx(xml: string): GpxImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid GPX XML: ${parseError.textContent}`);
  }

  const root = doc.documentElement;
  const now = Date.now();
  let skippedPoints = 0;

  // Parse standalone waypoints (<wpt>)
  const wptEls = getElements(root, "wpt");
  const waypoints: StandaloneWaypoint[] = [];
  for (const wptEl of wptEls) {
    const latLon = parseLatLon(wptEl);
    if (!latLon) {
      skippedPoints++;
      continue;
    }
    waypoints.push({
      id: generateUUID(),
      lat: latLon.lat,
      lon: latLon.lon,
      name: childText(wptEl, "name") ?? "Imported Waypoint",
      notes: childText(wptEl, "desc") ?? "",
      icon: parseWaypointIcon(childText(wptEl, "sym")),
      createdAt: now,
      updatedAt: now,
    });
  }

  // Parse routes (<rte>)
  const rteEls = getElements(root, "rte");
  const routes: Route[] = rteEls.map((rteEl, i) => {
    const rteptEls = getElements(rteEl, "rtept");
    const routeWaypoints: Waypoint[] = [];
    for (const ptEl of rteptEls) {
      const latLon = parseLatLon(ptEl);
      if (!latLon) {
        skippedPoints++;
        continue;
      }
      routeWaypoints.push({
        lat: latLon.lat,
        lon: latLon.lon,
        name: childText(ptEl, "name") ?? "",
      });
    }

    return {
      id: generateUUID(),
      name: childText(rteEl, "name") ?? `Imported Route ${i + 1}`,
      createdAt: now,
      color: parseColor(rteEl, i),
      visible: true,
      waypoints: routeWaypoints,
    };
  });

  // Parse tracks (<trk>)
  const trkEls = getElements(root, "trk");
  const tracks: Array<{ meta: TrackMeta; points: TrackPoint[] }> = trkEls.map(
    (trkEl, i) => {
      // Merge all <trkseg> segments into one
      const segEls = getElements(trkEl, "trkseg");
      const points: TrackPoint[] = [];
      for (const seg of segEls) {
        const trkptEls = getElements(seg, "trkpt");
        for (const ptEl of trkptEls) {
          const latLon = parseLatLon(ptEl);
          if (!latLon) {
            skippedPoints++;
            continue;
          }
          const timeStr = childText(ptEl, "time");
          const sogStr = pelorusExt(ptEl, "sog");
          const cogStr = pelorusExt(ptEl, "cog");
          const accStr = pelorusExt(ptEl, "accuracy");
          const latRawStr = pelorusExt(ptEl, "lat-raw");
          const lonRawStr = pelorusExt(ptEl, "lon-raw");
          const point: TrackPoint = {
            lat: latLon.lat,
            lon: latLon.lon,
            timestamp: timeStr ? new Date(timeStr).getTime() : 0,
            sog: sogStr !== null ? Number.parseFloat(sogStr) : null,
            cog: cogStr !== null ? Number.parseFloat(cogStr) : null,
          };
          if (accStr !== null) {
            point.accuracy = Number.parseFloat(accStr);
          }
          if (latRawStr !== null && lonRawStr !== null) {
            point.rawLat = Number.parseFloat(latRawStr);
            point.rawLon = Number.parseFloat(lonRawStr);
          }
          points.push(point);
        }
      }

      const id = generateUUID();
      return {
        meta: {
          id,
          name: childText(trkEl, "name") ?? `Imported Track ${i + 1}`,
          createdAt: now,
          color: parseColor(trkEl, i),
          visible: true,
          pointCount: points.length,
        },
        points,
      };
    },
  );

  if (skippedPoints > 0) {
    console.warn(
      `GPX import: skipped ${skippedPoints} point(s) with missing or out-of-range lat/lon`,
    );
  }

  return { routes, tracks, waypoints, skippedPoints };
}
