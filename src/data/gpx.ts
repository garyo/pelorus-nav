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
  if (pt.sog !== null || pt.cog !== null) {
    xml += "        <extensions>\n";
    if (pt.sog !== null) {
      xml += `          <pelorus:sog>${pt.sog}</pelorus:sog>\n`;
    }
    if (pt.cog !== null) {
      xml += `          <pelorus:cog>${pt.cog}</pelorus:cog>\n`;
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
}

/**
 * Get text content of a child element by local name.
 * Handles both namespaced and bare GPX elements.
 */
function childText(parent: Element, localName: string): string | null {
  // Try namespace-aware first
  const nsEl = parent.getElementsByTagNameNS(GPX_NS, localName)[0];
  if (nsEl?.textContent) return nsEl.textContent.trim();
  // Fall back to bare element name
  const bareEl = parent.getElementsByTagName(localName)[0];
  if (bareEl?.textContent) return bareEl.textContent.trim();
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

/** Get all elements matching a local name (namespace-aware with fallback). */
function getElements(parent: Element, localName: string): Element[] {
  let els = Array.from(parent.getElementsByTagNameNS(GPX_NS, localName));
  if (els.length === 0) {
    els = Array.from(parent.getElementsByTagName(localName));
  }
  return els;
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

  // Parse standalone waypoints (<wpt>)
  const wptEls = getElements(root, "wpt");
  const waypoints: StandaloneWaypoint[] = wptEls.map((wptEl) => ({
    id: generateUUID(),
    lat: Number.parseFloat(wptEl.getAttribute("lat") ?? "0"),
    lon: Number.parseFloat(wptEl.getAttribute("lon") ?? "0"),
    name: childText(wptEl, "name") ?? "Imported Waypoint",
    notes: childText(wptEl, "desc") ?? "",
    icon: parseWaypointIcon(childText(wptEl, "sym")),
    createdAt: now,
    updatedAt: now,
  }));

  // Parse routes (<rte>)
  const rteEls = getElements(root, "rte");
  const routes: Route[] = rteEls.map((rteEl, i) => {
    const rteptEls = getElements(rteEl, "rtept");
    const routeWaypoints: Waypoint[] = rteptEls.map((ptEl) => ({
      lat: Number.parseFloat(ptEl.getAttribute("lat") ?? "0"),
      lon: Number.parseFloat(ptEl.getAttribute("lon") ?? "0"),
      name: childText(ptEl, "name") ?? "",
    }));

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
          const timeStr = childText(ptEl, "time");
          const sogStr = pelorusExt(ptEl, "sog");
          const cogStr = pelorusExt(ptEl, "cog");
          points.push({
            lat: Number.parseFloat(ptEl.getAttribute("lat") ?? "0"),
            lon: Number.parseFloat(ptEl.getAttribute("lon") ?? "0"),
            timestamp: timeStr ? new Date(timeStr).getTime() : 0,
            sog: sogStr !== null ? Number.parseFloat(sogStr) : null,
            cog: cogStr !== null ? Number.parseFloat(cogStr) : null,
          });
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

  return { routes, tracks, waypoints };
}
