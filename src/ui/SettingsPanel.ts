/**
 * Settings panel — gear icon in top bar, dropdown with depth unit + detail level.
 */

import {
  type ChartMode,
  type DepthUnit,
  type DetailLevel,
  depthUnitLabel,
  getSettings,
  LAYER_GROUP_LABELS,
  onSettingsChange,
  type SpeedUnit,
  updateSettings,
} from "../settings";

const DEPTH_UNITS: { value: DepthUnit; label: string }[] = [
  { value: "meters", label: "Meters" },
  { value: "feet", label: "Feet" },
  { value: "fathoms", label: "Fathoms" },
];

const DETAIL_LABELS: Record<DetailLevel, string> = {
  "-1": "Base",
  "0": "Standard",
  "1": "Standard+",
  "2": "Full",
};

export function createSettingsPanel(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "settings-wrapper";

  // Depth unit indicator
  const unitBadge = document.createElement("span");
  unitBadge.className = "depth-unit-badge";
  unitBadge.textContent = depthUnitLabel(getSettings().depthUnit);
  wrapper.appendChild(unitBadge);

  onSettingsChange((s) => {
    unitBadge.textContent = depthUnitLabel(s.depthUnit);
  });

  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.setAttribute("aria-label", "Settings");
  btn.innerHTML = "&#9881;"; // gear icon
  wrapper.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  panel.innerHTML = buildPanelHTML();
  wrapper.appendChild(panel);

  container.appendChild(wrapper);

  // Toggle panel
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target as Node)) {
      panel.classList.remove("open");
    }
  });

  // Depth unit selector
  const unitSelect = panel.querySelector(
    "#settings-depth-unit",
  ) as HTMLSelectElement;
  unitSelect.addEventListener("change", () => {
    updateSettings({ depthUnit: unitSelect.value as DepthUnit });
  });

  // Detail level slider
  const slider = panel.querySelector(
    "#settings-detail-level",
  ) as HTMLInputElement;
  const sliderLabel = panel.querySelector(
    "#settings-detail-label",
  ) as HTMLSpanElement;
  slider.addEventListener("input", () => {
    const level = Number(slider.value) as DetailLevel;
    sliderLabel.textContent = DETAIL_LABELS[level];
    updateSettings({ detailLevel: level });
  });

  // GPS source selector
  const gpsSelect = panel.querySelector(
    "#settings-gps-source",
  ) as HTMLSelectElement | null;
  if (gpsSelect) {
    gpsSelect.addEventListener("change", () => {
      updateSettings({ gpsSource: gpsSelect.value });
    });
  }

  // Chart mode selector
  const modeSelect = panel.querySelector(
    "#settings-chart-mode",
  ) as HTMLSelectElement | null;
  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      updateSettings({ chartMode: modeSelect.value as ChartMode });
    });
  }

  // Speed unit selector
  const speedSelect = panel.querySelector(
    "#settings-speed-unit",
  ) as HTMLSelectElement | null;
  if (speedSelect) {
    speedSelect.addEventListener("change", () => {
      updateSettings({ speedUnit: speedSelect.value as SpeedUnit });
    });
  }

  // Accuracy circle toggle
  const accuracyCb = panel.querySelector(
    "#settings-accuracy-circle",
  ) as HTMLInputElement | null;
  if (accuracyCb) {
    accuracyCb.addEventListener("change", () => {
      updateSettings({ showAccuracyCircle: accuracyCb.checked });
    });
  }

  // Layer group toggles
  for (const groupId of Object.keys(LAYER_GROUP_LABELS)) {
    const cb = panel.querySelector(
      `#settings-group-${groupId}`,
    ) as HTMLInputElement | null;
    if (cb) {
      cb.addEventListener("change", () => {
        const groups = { ...getSettings().layerGroups, [groupId]: cb.checked };
        updateSettings({ layerGroups: groups });
      });
    }
  }
}

function buildPanelHTML(): string {
  const settings = getSettings();
  const unitOptions = DEPTH_UNITS.map(
    (u) =>
      `<option value="${u.value}"${u.value === settings.depthUnit ? " selected" : ""}>${u.label}</option>`,
  ).join("");

  const groupToggles = Object.entries(LAYER_GROUP_LABELS)
    .map(([id, label]) => {
      const checked = settings.layerGroups[id] !== false ? " checked" : "";
      return `<label class="settings-toggle"><input type="checkbox" id="settings-group-${id}"${checked}> ${label}</label>`;
    })
    .join("\n      ");

  const GPS_SOURCES = [
    { value: "simulator", label: "Simulator" },
    { value: "browser-gps", label: "Browser GPS" },
    { value: "web-serial", label: "USB GPS (Serial)" },
    { value: "signalk", label: "Signal K" },
  ];
  const gpsOptions = GPS_SOURCES.map(
    (s) =>
      `<option value="${s.value}"${s.value === settings.gpsSource ? " selected" : ""}>${s.label}</option>`,
  ).join("");

  const CHART_MODES: { value: ChartMode; label: string }[] = [
    { value: "follow", label: "Follow" },
    { value: "course-up", label: "Course Up" },
    { value: "north-up", label: "North Up" },
    { value: "free", label: "Free" },
  ];
  const modeOptions = CHART_MODES.map(
    (m) =>
      `<option value="${m.value}"${m.value === settings.chartMode ? " selected" : ""}>${m.label}</option>`,
  ).join("");

  const SPEED_UNITS: { value: SpeedUnit; label: string }[] = [
    { value: "knots", label: "Knots" },
    { value: "mph", label: "MPH" },
    { value: "kph", label: "km/h" },
  ];
  const speedOptions = SPEED_UNITS.map(
    (u) =>
      `<option value="${u.value}"${u.value === settings.speedUnit ? " selected" : ""}>${u.label}</option>`,
  ).join("");

  const accuracyChecked = settings.showAccuracyCircle ? " checked" : "";

  return `
    <div class="settings-row">
      <label for="settings-depth-unit">Depth units</label>
      <select id="settings-depth-unit">${unitOptions}</select>
    </div>
    <div class="settings-row">
      <label for="settings-detail-level">Detail</label>
      <div class="settings-slider-group">
        <input type="range" id="settings-detail-level" min="-1" max="2" step="1" value="${settings.detailLevel}">
        <span id="settings-detail-label">${DETAIL_LABELS[settings.detailLevel]}</span>
      </div>
    </div>
    <div class="settings-row settings-group-section">
      <label>Layer groups</label>
      <div class="settings-toggles">
      ${groupToggles}
      </div>
    </div>
    <hr style="border-color:#444;margin:8px 0">
    <div class="settings-row">
      <label for="settings-gps-source">GPS source</label>
      <select id="settings-gps-source">${gpsOptions}</select>
    </div>
    <div class="settings-row">
      <label for="settings-chart-mode">Chart mode</label>
      <select id="settings-chart-mode">${modeOptions}</select>
    </div>
    <div class="settings-row">
      <label for="settings-speed-unit">Speed units</label>
      <select id="settings-speed-unit">${speedOptions}</select>
    </div>
    <div class="settings-row">
      <label class="settings-toggle">
        <input type="checkbox" id="settings-accuracy-circle"${accuracyChecked}> Accuracy circle
      </label>
    </div>
  `;
}
