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

/** Round to `decimals` places, dropping trailing zeros (4.6, not 4.60000). */
function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gpxHeader(name: string, hoisted?: Map<string, string>): string {
  const extra = [...(hoisted?.entries() ?? [])]
    .map(([prefix, uri]) => `     xmlns:${prefix}="${uri}"\n`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Pelorus Nav"\n` +
    `     xmlns="${GPX_NS}"\n` +
    `${extra}` +
    `     xmlns:pelorus="${PELORUS_NS}">\n` +
    `  <metadata>\n` +
    `    <name>${escapeXml(name)}</name>\n` +
    `    <time>${new Date().toISOString()}</time>\n` +
    `  </metadata>\n`
  );
}

const GPX_FOOTER = "</gpx>\n";

function waypointXml(
  wp: Waypoint,
  indent: string,
  hoisted?: Map<string, string>,
): string {
  let xml = `${indent}<rtept lat="${wp.lat}" lon="${wp.lon}">\n`;
  if (wp.name) {
    xml += `${indent}  <name>${escapeXml(wp.name)}</name>\n`;
  }
  // A route point's own extensions (arrival radius, range rings, the
  // producer's id for that point) belong to the point, not the route.
  xml += extensionsXml("", wp.sourceExtensions, `${indent}  `, hoisted);
  xml += `${indent}</rtept>\n`;
  return xml;
}

/**
 * The `<extensions>` block for an item: what we own, then whatever it arrived
 * with. Ours come first so a reader hitting `pelorus:id` doesn't have to scan
 * past a producer's whole payload to find it.
 */
function extensionsXml(
  own: string,
  preserved: string | undefined,
  indent: string,
  hoisted: Map<string, string> = new Map(),
): string {
  if (!own && !preserved) return "";
  let xml = `${indent}<extensions>\n`;
  xml += own;
  if (preserved) {
    xml += `${indentExtensions(stripHoisted(preserved, hoisted), `${indent}  `)}\n`;
  }
  xml += `${indent}</extensions>\n`;
  return xml;
}

function standaloneWaypointXml(
  wp: StandaloneWaypoint,
  hoisted?: Map<string, string>,
): string {
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
  let own = `      <pelorus:id>${escapeXml(wp.id)}</pelorus:id>\n`;
  if (wp.folder) {
    own += `      <pelorus:folder>${escapeXml(wp.folder)}</pelorus:folder>\n`;
  }
  xml += extensionsXml(own, wp.sourceExtensions, "    ", hoisted);
  xml += "  </wpt>\n";
  return xml;
}

function routeXml(route: Route, hoisted?: Map<string, string>): string {
  let xml = "  <rte>\n";
  xml += `    <name>${escapeXml(route.name)}</name>\n`;
  let own = `      <pelorus:id>${escapeXml(route.id)}</pelorus:id>\n`;
  if (route.color) {
    own += `      <pelorus:color>${escapeXml(route.color)}</pelorus:color>\n`;
  }
  if (route.folder) {
    own += `      <pelorus:folder>${escapeXml(route.folder)}</pelorus:folder>\n`;
  }
  xml += extensionsXml(own, route.sourceExtensions, "    ", hoisted);
  for (const wp of route.waypoints) {
    xml += waypointXml(wp, "    ", hoisted);
  }
  xml += "  </rte>\n";
  return xml;
}

function trackPointXml(pt: TrackPoint): string {
  // 7 decimals ≈ 1 cm — plenty for a marine track, vs ~15 raw float digits.
  let xml = `      <trkpt lat="${round(pt.lat, 7)}" lon="${round(pt.lon, 7)}">\n`;
  if (pt.timestamp) {
    xml += `        <time>${new Date(pt.timestamp).toISOString()}</time>\n`;
  }
  const emitRaw =
    EMIT_RAW_TRACK_POINTS && pt.rawLat !== undefined && pt.rawLon !== undefined;
  const hasAccuracy = pt.accuracy !== null && pt.accuracy !== undefined;
  if (pt.sog !== null || pt.cog !== null || hasAccuracy || emitRaw) {
    xml += "        <extensions>\n";
    if (pt.sog !== null) {
      // 0.01-knot / 0.1-degree resolution is well beyond GPS accuracy; the
      // raw floats otherwise emit ~15 meaningless digits per point.
      xml += `          <pelorus:sog>${round(pt.sog, 2)}</pelorus:sog>\n`;
    }
    if (pt.cog !== null) {
      xml += `          <pelorus:cog>${round(pt.cog, 1)}</pelorus:cog>\n`;
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

function trackXml(
  meta: TrackMeta,
  points: TrackPoint[],
  hoisted?: Map<string, string>,
): string {
  let xml = "  <trk>\n";
  xml += `    <name>${escapeXml(meta.name)}</name>\n`;
  let own = `      <pelorus:id>${escapeXml(meta.id)}</pelorus:id>\n`;
  if (meta.color) {
    own += `      <pelorus:color>${escapeXml(meta.color)}</pelorus:color>\n`;
  }
  if (meta.folder) {
    own += `      <pelorus:folder>${escapeXml(meta.folder)}</pelorus:folder>\n`;
  }
  xml += extensionsXml(own, meta.sourceExtensions, "    ", hoisted);
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
  const ns = collectNamespaces(allPreserved([route], [], []));
  return gpxHeader(route.name, ns) + routeXml(route, ns) + GPX_FOOTER;
}

/** Serialize a single track (with loaded points) to GPX. */
export function trackToGpx(meta: TrackMeta, points: TrackPoint[]): string {
  const ns = collectNamespaces([meta.sourceExtensions]);
  return gpxHeader(meta.name, ns) + trackXml(meta, points, ns) + GPX_FOOTER;
}

/** Serialize standalone waypoints to GPX. */
export function waypointsToGpx(waypoints: StandaloneWaypoint[]): string {
  const ns = collectNamespaces(waypoints.map((w) => w.sourceExtensions));
  let xml = gpxHeader("Waypoints", ns);
  for (const wp of waypoints) {
    xml += standaloneWaypointXml(wp, ns);
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
  const ns = collectNamespaces(allPreserved(routes, tracks, waypoints));
  let xml = gpxHeader("Pelorus Nav Export", ns);
  for (const wp of waypoints) {
    xml += standaloneWaypointXml(wp, ns);
  }
  for (const route of routes) {
    xml += routeXml(route, ns);
  }
  for (const { meta, points } of tracks) {
    xml += trackXml(meta, points, ns);
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
  /** The file's `<metadata><name>`, when it carries one. Names the folder a
   *  multi-route import is offered — it travels inside the file, so it
   *  survives arriving from a cloud drive with no usable filename. */
  metadataName: string | null;
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

/**
 * The id an item carries from wherever it came from, for re-import matching
 * (see gpx-merge.ts). Ours is `pelorus:id`; Garmin writes `uuidx:uuid`, which
 * is read by local name so any producer using that convention works without
 * hard-coding another namespace URI.
 */
function sourceIdOf(el: Element): string | undefined {
  const own = pelorusExt(el, "id");
  if (own) return own;
  // Producers name their identifier differently — Garmin uuidx:uuid, OpenCPN
  // opencpn:guid — so match on the local name and let the namespace be
  // whatever it is.
  for (const ext of el.getElementsByTagName("*")) {
    const local = ext.localName;
    if ((local === "uuid" || local === "guid") && ext.textContent?.trim()) {
      return ext.textContent.trim();
    }
  }
  return undefined;
}

/**
 * Extension elements we drop rather than carry: ones whose meaning we now own
 * on this device, so handing the file's stale value back would contradict
 * what the user has since done here.
 */
const NOT_PRESERVED = new Set(["viz"]);

/**
 * The item's `<extensions>` children, serialized, minus our own and minus
 * anything in NOT_PRESERVED.
 *
 * Kept verbatim and written back out on export so a file that goes home to
 * the app it came from arrives intact: OpenCPN's planned speed and departure,
 * a waypoint's arrival radius and range rings, Garmin's display mode — none
 * of which Pelorus models, and all of which the far side loses forever if we
 * quietly drop it. The producer's own identifier travels in here too, which
 * is what lets that app match its own data instead of duplicating it.
 *
 * Each element is serialized standalone so its namespace declaration comes
 * with it, making the stored string self-contained: it survives in IndexedDB
 * across sessions with no document-level prefix map to keep in step.
 */
function captureExtensions(el: Element): string | undefined {
  const ext = getElements(el, "extensions")[0];
  if (!ext) return undefined;
  const serializer = new XMLSerializer();
  const kept: string[] = [];
  for (const child of Array.from(ext.children)) {
    if (child.namespaceURI === PELORUS_NS) continue;
    if (NOT_PRESERVED.has(child.localName)) continue;
    kept.push(serializer.serializeToString(child));
  }
  return kept.length > 0 ? kept.join("\n") : undefined;
}

/** Re-indent preserved extension XML to sit inside our output. */
function indentExtensions(xml: string, indent: string): string {
  return xml
    .split("\n")
    .map((line) => `${indent}${line.trim()}`)
    .join("\n");
}

/**
 * Namespace declarations carried inside preserved extension strings.
 *
 * Each stored chunk repeats its own `xmlns:` so it stands alone in the
 * database, but a file with a few hundred of them repeating the same handful
 * of URIs is noise. Exports hoist the distinct ones to the root element and
 * drop them from the chunks — same document, a good deal smaller.
 */
const XMLNS_DECL = /\s+xmlns:([A-Za-z][\w.-]*)="([^"]+)"/g;

function collectNamespaces(
  items: readonly (string | undefined)[],
): Map<string, string> {
  const found = new Map<string, string>();
  for (const xml of items) {
    if (!xml) continue;
    for (const [, prefix, uri] of xml.matchAll(XMLNS_DECL)) {
      // First declaration of a prefix wins; a second URI for the same prefix
      // keeps its inline declaration rather than being silently rebound.
      if (!found.has(prefix)) found.set(prefix, uri);
    }
  }
  return found;
}

/** Drop declarations the header now carries; leave any that would rebind. */
function stripHoisted(xml: string, hoisted: Map<string, string>): string {
  return xml.replace(XMLNS_DECL, (decl, prefix, uri) =>
    hoisted.get(prefix) === uri ? "" : decl,
  );
}

/** Every preserved extension string in an export, route points included. */
function allPreserved(
  routes: readonly Route[],
  tracks: ReadonlyArray<{ meta: TrackMeta }>,
  waypoints: readonly StandaloneWaypoint[],
): Array<string | undefined> {
  return [
    ...routes.flatMap((r) => [
      r.sourceExtensions,
      ...r.waypoints.map((w) => w.sourceExtensions),
    ]),
    ...tracks.map((t) => t.meta.sourceExtensions),
    ...waypoints.map((w) => w.sourceExtensions),
  ];
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
    const wptFolder = pelorusExt(wptEl, "folder");
    const wptSourceId = sourceIdOf(wptEl);
    const wptExt = captureExtensions(wptEl);
    waypoints.push({
      id: generateUUID(),
      ...(wptSourceId ? { sourceId: wptSourceId } : {}),
      lat: latLon.lat,
      lon: latLon.lon,
      name: childText(wptEl, "name") ?? "Imported Waypoint",
      notes: childText(wptEl, "desc") ?? "",
      icon: parseWaypointIcon(childText(wptEl, "sym")),
      createdAt: now,
      updatedAt: now,
      visible: true,
      ...(wptFolder ? { folder: wptFolder } : {}),
      ...(wptExt ? { sourceExtensions: wptExt } : {}),
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
      const ptExt = captureExtensions(ptEl);
      routeWaypoints.push({
        lat: latLon.lat,
        lon: latLon.lon,
        name: childText(ptEl, "name") ?? "",
        ...(ptExt ? { sourceExtensions: ptExt } : {}),
      });
    }

    const folder = pelorusExt(rteEl, "folder");
    const sourceId = sourceIdOf(rteEl);
    const rteExt = captureExtensions(rteEl);
    return {
      id: generateUUID(),
      ...(sourceId ? { sourceId } : {}),
      name: childText(rteEl, "name") ?? `Imported Route ${i + 1}`,
      createdAt: now,
      color: parseColor(rteEl, i),
      visible: true,
      ...(folder ? { folder } : {}),
      ...(rteExt ? { sourceExtensions: rteExt } : {}),
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
      const trkSourceId = sourceIdOf(trkEl);
      return {
        meta: {
          id,
          ...(trkSourceId ? { sourceId: trkSourceId } : {}),
          name: childText(trkEl, "name") ?? `Imported Track ${i + 1}`,
          createdAt: now,
          color: parseColor(trkEl, i),
          visible: true,
          pointCount: points.length,
          ...(captureExtensions(trkEl)
            ? { sourceExtensions: captureExtensions(trkEl) as string }
            : {}),
          ...(pelorusExt(trkEl, "folder")
            ? { folder: pelorusExt(trkEl, "folder") as string }
            : {}),
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

  const metadataEl = getElements(root, "metadata")[0];
  const metadataName = metadataEl ? childText(metadataEl, "name") : null;

  return { routes, tracks, waypoints, skippedPoints, metadataName };
}
