import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: "osm-tiles",
        type: "raster",
        source: "osm",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
  center: [-71.06, 42.36], // Boston Harbor
  zoom: 12,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(
  new maplibregl.ScaleControl({ unit: "nautical" }),
  "bottom-left",
);
