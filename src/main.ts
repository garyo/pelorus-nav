import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import {
  ChartManager,
  ChartSwitcherControl,
  NOAAChartProvider,
  NOAAECDISProvider,
  OSMChartProvider,
} from "./chart";

const chartManager = new ChartManager({
  container: "map",
  center: [-71.06, 42.36], // Boston Harbor
  zoom: 12,
  providers: [
    new NOAAChartProvider(),
    new NOAAECDISProvider(),
    new OSMChartProvider(),
  ],
  initialProviderId: "noaa-ncds",
});

chartManager.map.addControl(new ChartSwitcherControl(chartManager), "top-left");
