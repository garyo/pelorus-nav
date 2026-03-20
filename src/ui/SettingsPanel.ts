/**
 * Settings panel — gear icon in top bar, tabbed dropdown.
 * Tabs: Appearance, Chart Layers, Navigation.
 */

import { CapacitorGPSProvider } from "../navigation/CapacitorGPSProvider";
import {
  type BearingMode,
  type ChartMode,
  type CourseLineDuration,
  convertDepth,
  type DepthUnit,
  type DetailLevel,
  type DisplayTheme,
  depthConversionFactor,
  depthUnitLabel,
  type GpsRateMode,
  getSettings,
  LAYER_GROUP_LABELS,
  onSettingsChange,
  type SpeedUnit,
  type SymbologyScheme,
  updateSettings,
  type WakeLockMode,
} from "../settings";
import { bearingModeLabel } from "../utils/magnetic";
import { iconSettings, setIcon } from "./icons";

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

export interface SettingsPanelHandle {
  /** Close the settings panel. */
  hide(): void;
  /** Whether the settings panel is currently open. */
  isOpen(): boolean;
  /** Register a callback invoked when the settings panel opens. */
  onOpen(fn: () => void): void;
}

export function createSettingsPanel(
  container: HTMLElement,
): SettingsPanelHandle {
  const wrapper = document.createElement("div");
  wrapper.className = "settings-wrapper";

  // Depth unit indicator
  const unitBadge = document.createElement("span");
  unitBadge.className = "depth-unit-badge";
  unitBadge.textContent = depthUnitLabel(getSettings().depthUnit);
  wrapper.appendChild(unitBadge);

  // Bearing mode indicator
  const bearingBadge = document.createElement("span");
  bearingBadge.className = "depth-unit-badge";
  const initSettings = getSettings();
  bearingBadge.textContent = `\u00b0${bearingModeLabel(initSettings.bearingMode)}`;
  wrapper.appendChild(bearingBadge);

  onSettingsChange((s) => {
    unitBadge.textContent = depthUnitLabel(s.depthUnit);
    bearingBadge.textContent = `\u00b0${bearingModeLabel(s.bearingMode)}`;
  });

  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.setAttribute("aria-label", "Settings");
  setIcon(btn, iconSettings);
  wrapper.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  buildTabbedPanel(panel);
  document.body.appendChild(panel);

  container.appendChild(wrapper);

  const openListeners: (() => void)[] = [];

  // Toggle panel
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !panel.classList.contains("open");
    panel.classList.toggle("open");
    if (opening) {
      for (const fn of openListeners) fn();
    }
  });

  // Close on outside click — check both wrapper and panel (different DOM trees)
  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!wrapper.contains(target) && !panel.contains(target)) {
      panel.classList.remove("open");
    }
  });

  return {
    hide() {
      panel.classList.remove("open");
    },
    isOpen() {
      return panel.classList.contains("open");
    },
    onOpen(fn: () => void) {
      openListeners.push(fn);
    },
  };
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

  // Symbology scheme
  const SYMBOLOGY_OPTIONS = [
    { value: "pelorus-standard", label: "Pelorus Standard" },
    { value: "iho-s52", label: "IHO S-52" },
    { value: "simplified-minimal", label: "Minimal" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Symbology",
      "settings-symbology",
      SYMBOLOGY_OPTIONS,
      settings.symbologyScheme,
      (v) => updateSettings({ symbologyScheme: v as SymbologyScheme }),
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

  // Depth threshold sliders
  tab.appendChild(buildDepthThresholdSliders());

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

  // Bearings (true/magnetic)
  const BEARING_MODES = [
    { value: "magnetic", label: "Magnetic" },
    { value: "true", label: "True" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Bearings",
      "settings-bearing-mode",
      BEARING_MODES,
      settings.bearingMode,
      (v) => updateSettings({ bearingMode: v as BearingMode }),
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

  // OSM underlay (only useful with vector charts)
  tab.appendChild(
    buildCheckboxRow(
      "OSM map under vector charts",
      "settings-osm-underlay",
      settings.showOSMUnderlay,
      (v) => updateSettings({ showOSMUnderlay: v }),
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

  // GPS source — "Device GPS" auto-selects native Capacitor or browser geolocation
  const deviceGpsValue = CapacitorGPSProvider.isAvailable()
    ? "capacitor-gps"
    : "browser-gps";
  const GPS_SOURCES: { value: string; label: string }[] = [
    { value: "none", label: "None" },
    { value: "simulator", label: "Simulator" },
    { value: deviceGpsValue, label: "Device GPS" },
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

  // GPS rate mode
  const GPS_RATE_MODES = [
    { value: "adaptive", label: "Adaptive" },
    { value: "manual", label: "Manual" },
  ];
  tab.appendChild(
    buildSelectRow(
      "GPS rate",
      "settings-gps-rate-mode",
      GPS_RATE_MODES,
      settings.gpsRateMode,
      (v) => {
        updateSettings({ gpsRateMode: v as GpsRateMode });
      },
    ),
  );

  // Manual interval (shown only when manual mode selected)
  const MANUAL_INTERVAL_OPTIONS = [
    { value: "2000", label: "2s" },
    { value: "5000", label: "5s" },
    { value: "10000", label: "10s" },
  ];
  const manualRow = buildSelectRow(
    "Update interval",
    "settings-manual-interval",
    MANUAL_INTERVAL_OPTIONS,
    String(settings.manualUpdateIntervalMs),
    (v) => updateSettings({ manualUpdateIntervalMs: Number(v) }),
  );
  manualRow.style.display = settings.gpsRateMode === "manual" ? "" : "none";
  tab.appendChild(manualRow);

  onSettingsChange((s) => {
    manualRow.style.display = s.gpsRateMode === "manual" ? "" : "none";
  });

  // Wake lock (keep screen on)
  const WAKE_LOCK_OPTIONS = [
    { value: "off", label: "Off" },
    { value: "when-nav", label: "When GPS active" },
    { value: "always", label: "Always" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Keep screen on",
      "settings-wake-lock",
      WAKE_LOCK_OPTIONS,
      settings.wakeLock,
      (v) => updateSettings({ wakeLock: v as WakeLockMode }),
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

/**
 * Build depth threshold sliders (shallow and deep).
 * Values are stored in meters but displayed in the user's chosen depth unit.
 * The slider operates in display units and converts back to meters on change.
 */
function buildDepthThresholdSliders(): HTMLElement {
  const container = document.createElement("div");

  // Max slider values in meters for each unit (60m ≈ 200ft ≈ 33fm)
  const MAX_METERS = 60;

  function currentUnit(): DepthUnit {
    return getSettings().depthUnit;
  }

  function maxForUnit(unit: DepthUnit): number {
    return Math.round(convertDepth(MAX_METERS, unit));
  }

  function stepForUnit(unit: DepthUnit): number {
    switch (unit) {
      case "feet":
        return 1;
      case "fathoms":
        return 0.5;
      default:
        return 0.5;
    }
  }

  function metersToDisplay(m: number, unit: DepthUnit): number {
    return Math.round(convertDepth(m, unit) * 10) / 10;
  }

  function displayToMeters(d: number, unit: DepthUnit): number {
    return d / depthConversionFactor(unit);
  }

  // Shallow slider
  const shallowRow = document.createElement("div");
  shallowRow.className = "settings-row";
  const shallowLabel = document.createElement("label");
  shallowLabel.htmlFor = "settings-shallow-depth";
  shallowLabel.textContent = "Shallow";
  shallowRow.appendChild(shallowLabel);

  const shallowGroup = document.createElement("div");
  shallowGroup.className = "settings-slider-group";
  const shallowSlider = document.createElement("input");
  shallowSlider.type = "range";
  shallowSlider.id = "settings-shallow-depth";
  const shallowInput = document.createElement("input");
  shallowInput.type = "number";

  // Deep slider
  const deepRow = document.createElement("div");
  deepRow.className = "settings-row";
  const deepLabel = document.createElement("label");
  deepLabel.htmlFor = "settings-deep-depth";
  deepLabel.textContent = "Deep";
  deepRow.appendChild(deepLabel);

  const deepGroup = document.createElement("div");
  deepGroup.className = "settings-slider-group";
  const deepSlider = document.createElement("input");
  deepSlider.type = "range";
  const deepInput = document.createElement("input");
  deepInput.type = "number";

  /** Suffix element showing the unit abbreviation next to each input. */
  const shallowSuffix = document.createElement("span");
  shallowSuffix.className = "unit-suffix";
  const deepSuffix = document.createElement("span");
  deepSuffix.className = "unit-suffix";

  let syncing = false;

  function syncSliders() {
    syncing = true;
    const unit = currentUnit();
    const max = maxForUnit(unit);
    const step = stepForUnit(unit);
    const s = getSettings();
    const unitStr = depthUnitLabel(unit);

    shallowSlider.min = "0";
    shallowSlider.max = String(max);
    shallowSlider.step = String(step);
    const shallowDisplay = metersToDisplay(s.shallowDepth, unit);
    shallowSlider.value = String(shallowDisplay);
    shallowInput.min = "0";
    shallowInput.max = String(max);
    shallowInput.step = String(step);
    shallowInput.value = String(shallowDisplay);
    shallowSuffix.textContent = unitStr;

    deepSlider.min = "0";
    deepSlider.max = String(max);
    deepSlider.step = String(step);
    const deepDisplay = metersToDisplay(s.deepDepth, unit);
    deepSlider.value = String(deepDisplay);
    deepInput.min = "0";
    deepInput.max = String(max);
    deepInput.step = String(step);
    deepInput.value = String(deepDisplay);
    deepSuffix.textContent = unitStr;
    syncing = false;
  }

  syncSliders();

  function applyShallow(displayVal: number) {
    const unit = currentUnit();
    const meters = displayToMeters(displayVal, unit);
    const s = getSettings();
    if (meters > s.deepDepth) {
      updateSettings({ shallowDepth: meters, deepDepth: meters });
    } else {
      updateSettings({ shallowDepth: meters });
    }
  }

  function applyDeep(displayVal: number) {
    const unit = currentUnit();
    const meters = displayToMeters(displayVal, unit);
    const s = getSettings();
    if (meters < s.shallowDepth) {
      updateSettings({ shallowDepth: meters, deepDepth: meters });
    } else {
      updateSettings({ deepDepth: meters });
    }
  }

  shallowSlider.addEventListener("input", () => {
    applyShallow(Number(shallowSlider.value));
  });

  shallowInput.addEventListener("change", () => {
    applyShallow(Number(shallowInput.value));
  });

  deepSlider.addEventListener("input", () => {
    applyDeep(Number(deepSlider.value));
  });

  deepInput.addEventListener("change", () => {
    applyDeep(Number(deepInput.value));
  });

  // Re-sync when any relevant setting changes (unit or thresholds)
  onSettingsChange(() => {
    if (!syncing) syncSliders();
  });

  shallowGroup.append(shallowSlider, shallowInput, shallowSuffix);
  shallowRow.appendChild(shallowGroup);
  deepGroup.append(deepSlider, deepInput, deepSuffix);
  deepRow.appendChild(deepGroup);

  container.append(shallowRow, deepRow);
  return container;
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
