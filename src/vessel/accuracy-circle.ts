/**
 * Generate a GeoJSON polygon representing a circle of given radius around a point.
 * Used for GPS accuracy visualization.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const VERTICES = 64;

export function accuracyCircleGeoJSON(
  lat: number,
  lng: number,
  radiusMeters: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angularRadius = radiusMeters / EARTH_RADIUS_M;

  const coordinates: [number, number][] = [];
  for (let i = 0; i <= VERTICES; i++) {
    const bearing = (2 * Math.PI * i) / VERTICES;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularRadius) +
        Math.cos(latRad) * Math.sin(angularRadius) * Math.cos(bearing),
    );
    const pLng =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(latRad),
        Math.cos(angularRadius) - Math.sin(latRad) * Math.sin(pLat),
      );
    coordinates.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}
