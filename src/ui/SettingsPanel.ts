/**
 * Settings panel — gear icon in top bar, tabbed dropdown.
 * Tabs: Appearance, Chart Layers, Navigation.
 */

import {
  type ChartMode,
  type CourseLineDuration,
  type DepthUnit,
  type DetailLevel,
  type DisplayTheme,
  depthUnitLabel,
  getSettings,
  LAYER_GROUP_LABELS,
  onSettingsChange,
  type SpeedUnit,
  updateSettings,
} from "../settings";
import { iconSettings } from "./icons";

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

const TAB_IDS = ["appearance", "layers", "navigation"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<TabId, string> = {
  appearance: "Appearance",
  layers: "Chart Layers",
  navigation: "Navigation",
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
  btn.innerHTML = iconSettings;
  wrapper.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  buildTabbedPanel(panel);
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
}

function buildTabbedPanel(panel: HTMLElement): void {
  const settings = getSettings();

  // --- Tab bar ---
  const tabBar = document.createElement("div");
  tabBar.className = "settings-tab-bar";

  const tabBodies = new Map<TabId, HTMLElement>();
  let activeTab: TabId = "appearance";

  for (const id of TAB_IDS) {
    const tabBtn = document.createElement("button");
    tabBtn.className = "settings-tab";
    tabBtn.textContent = TAB_LABELS[id];
    tabBtn.dataset.tab = id;
    tabBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveTab(id);
    });
    tabBar.appendChild(tabBtn);
  }
  panel.appendChild(tabBar);

  // --- Tab bodies ---
  const bodyContainer = document.createElement("div");
  bodyContainer.className = "settings-tab-content";

  tabBodies.set("appearance", buildAppearanceTab(settings));
  tabBodies.set("layers", buildLayersTab(settings));
  tabBodies.set("navigation", buildNavigationTab(settings));

  for (const [id, body] of tabBodies) {
    body.className = "settings-tab-body";
    body.dataset.tab = id;
    bodyContainer.appendChild(body);
  }
  panel.appendChild(bodyContainer);

  function setActiveTab(id: TabId) {
    activeTab = id;
    for (const tabBtn of tabBar.querySelectorAll<HTMLElement>(
      ".settings-tab",
    )) {
      tabBtn.classList.toggle("active", tabBtn.dataset.tab === id);
    }
    for (const [bodyId, body] of tabBodies) {
      body.style.display = bodyId === id ? "" : "none";
    }
  }
  setActiveTab(activeTab);
}

// --- Tab builders ---

function buildAppearanceTab(
  settings: ReturnType<typeof getSettings>,
): HTMLElement {
  const tab = document.createElement("div");

  // Display theme
  const DISPLAY_THEMES = [
    { value: "day", label: "Day" },
    { value: "dusk", label: "Dusk" },
    { value: "night", label: "Night" },
    { value: "eink", label: "E-ink" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Display theme",
      "settings-display-theme",
      DISPLAY_THEMES,
      settings.displayTheme,
      (v) => updateSettings({ displayTheme: v as DisplayTheme }),
    ),
  );

  // Depth units
  tab.appendChild(
    buildSelectRow(
      "Depth units",
      "settings-depth-unit",
      DEPTH_UNITS,
      settings.depthUnit,
      (v) => updateSettings({ depthUnit: v as DepthUnit }),
    ),
  );

  // Speed units
  const SPEED_UNITS = [
    { value: "knots", label: "Knots" },
    { value: "mph", label: "MPH" },
    { value: "kph", label: "km/h" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Speed units",
      "settings-speed-unit",
      SPEED_UNITS,
      settings.speedUnit,
      (v) => updateSettings({ speedUnit: v as SpeedUnit }),
    ),
  );

  // Detail level slider
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.htmlFor = "settings-detail-level";
  label.textContent = "Detail";
  row.appendChild(label);

  const sliderGroup = document.createElement("div");
  sliderGroup.className = "settings-slider-group";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "settings-detail-level";
  slider.min = "-1";
  slider.max = "2";
  slider.step = "1";
  slider.value = String(settings.detailLevel);

  const sliderLabel = document.createElement("span");
  sliderLabel.id = "settings-detail-label";
  sliderLabel.textContent = DETAIL_LABELS[settings.detailLevel];

  slider.addEventListener("input", () => {
    const level = Number(slider.value) as DetailLevel;
    sliderLabel.textContent = DETAIL_LABELS[level];
    updateSettings({ detailLevel: level });
  });

  sliderGroup.append(slider, sliderLabel);
  row.appendChild(sliderGroup);
  tab.appendChild(row);

  // Accuracy circle
  tab.appendChild(
    buildCheckboxRow(
      "Accuracy circle",
      "settings-accuracy-circle",
      settings.showAccuracyCircle,
      (v) => updateSettings({ showAccuracyCircle: v }),
    ),
  );

  return tab;
}

function buildLayersTab(settings: ReturnType<typeof getSettings>): HTMLElement {
  const tab = document.createElement("div");

  for (const [groupId, label] of Object.entries(LAYER_GROUP_LABELS)) {
    const checked = settings.layerGroups[groupId] !== false;
    tab.appendChild(
      buildCheckboxRow(label, `settings-group-${groupId}`, checked, (v) => {
        const groups = { ...getSettings().layerGroups, [groupId]: v };
        updateSettings({ layerGroups: groups });
      }),
    );
  }

  return tab;
}

function buildNavigationTab(
  settings: ReturnType<typeof getSettings>,
): HTMLElement {
  const tab = document.createElement("div");

  // GPS source
  const GPS_SOURCES = [
    { value: "none", label: "None" },
    { value: "simulator", label: "Simulator" },
    { value: "browser-gps", label: "Browser GPS" },
    { value: "web-serial", label: "USB GPS (Serial)" },
    { value: "signalk", label: "Signal K" },
  ];
  tab.appendChild(
    buildSelectRow(
      "GPS source",
      "settings-gps-source",
      GPS_SOURCES,
      settings.gpsSource,
      (v) => updateSettings({ gpsSource: v }),
    ),
  );

  // Chart mode
  const CHART_MODES = [
    { value: "follow", label: "Follow" },
    { value: "course-up", label: "Course Up" },
    { value: "north-up", label: "North Up" },
    { value: "free", label: "Free" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Chart mode",
      "settings-chart-mode",
      CHART_MODES,
      settings.chartMode,
      (v) => updateSettings({ chartMode: v as ChartMode }),
    ),
  );

  // Simulator speed
  const SIM_SPEED_OPTIONS = [
    { value: "1", label: "1x" },
    { value: "10", label: "10x" },
    { value: "50", label: "50x" },
    { value: "100", label: "100x" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Sim speed",
      "settings-sim-speed",
      SIM_SPEED_OPTIONS,
      String(settings.simulatorSpeed),
      (v) => updateSettings({ simulatorSpeed: Number(v) }),
    ),
  );

  // Course line duration
  const COURSE_LINE_OPTIONS = [
    { value: "0", label: "Off" },
    { value: "15", label: "15 min" },
    { value: "30", label: "30 min" },
    { value: "60", label: "1 hour" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Course line",
      "settings-course-line",
      COURSE_LINE_OPTIONS,
      String(settings.courseLineDuration),
      (v) =>
        updateSettings({
          courseLineDuration: Number(v) as CourseLineDuration,
        }),
    ),
  );

  return tab;
}

// --- Helpers ---

function buildSelectRow(
  labelText: string,
  id: string,
  options: { value: string; label: string }[],
  currentValue: string,
  onChange: (value: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  row.appendChild(label);

  const select = document.createElement("select");
  select.id = id;
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    option.selected = opt.value === currentValue;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  row.appendChild(select);

  return row;
}

function buildCheckboxRow(
  labelText: string,
  id: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.className = "settings-toggle";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = id;
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));

  label.append(cb, ` ${labelText}`);
  row.appendChild(label);

  return row;
}
