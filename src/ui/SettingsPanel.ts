/**
 * Settings panel — gear icon in top bar, tabbed dropdown.
 * Tabs: Appearance, Chart Layers, Navigation.
 */

import { Capacitor } from "@capacitor/core";
import { CapacitorGPSProvider } from "../navigation/CapacitorGPSProvider";
import {
  type BearingMode,
  type ChartBlend,
  type CourseLineDuration,
  convertDepth,
  type DepthUnit,
  type DetailLevel,
  type DisplayTheme,
  depthConversionFactor,
  depthUnitLabel,
  type GpsFilterMode,
  getLayerGroups,
  getPluginSetting,
  getPluginSettingsSchemas,
  getSettings,
  type InstrumentLayout,
  isLayerGroupEnabled,
  onSettingsChange,
  type SettingControl,
  type SimulatorMode,
  type SpeedUnit,
  type StreetUnderlayMode,
  setPluginSetting,
  updateSettings,
  type WakeLockMode,
} from "../settings";
import { bearingModeLabel } from "../utils/magnetic";
import { iconSettings } from "./icons";
import {
  maybeShowScreenTimeoutWarning,
  resetScreenTimeoutDismissal,
} from "./ScreenTimeoutDialog";
import { registerSurface } from "./SurfaceManager";
import { buildTopbarAction } from "./topbarButton";

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
  layers: "Charts & Layers",
  navigation: "Navigation",
};

/** Chart-source picker wiring passed in from main.ts. */
export interface ChartProvidersOpt {
  list: { id: string; name: string }[];
  getActiveId: () => string;
  setActive: (id: string) => void;
}

/** Live BLE link state + actions for the Navigation tab's status row. */
export interface GpsLinkOpt {
  isConnected: () => boolean;
  isReconnecting: () => boolean;
  /** Manual reconnect (reuses the chosen device where possible). */
  reconnect: () => void;
  /** Hard reset: full disconnect→connect, to clear a wedged link. */
  reset: () => void;
  /** Forget the saved device and re-run the picker (e.g. new pod hardware). */
  changeDevice: () => void;
}

export interface CreateSettingsPanelOpts {
  chartProviders: ChartProvidersOpt;
  /** Live BLE link state + reconnect/reset actions. */
  gpsLink: GpsLinkOpt;
  /** Open the live satellite diagnostics panel for the active provider. */
  openSatelliteDiagnostics: () => void;
  /** Open the persistent connection event log viewer. */
  openConnectionLog: () => void;
  /** Rewind the simulator to the start of its route/track. */
  restartSimulator: () => void;
}

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
  opts: CreateSettingsPanelOpts,
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

  const btn = buildTopbarAction(iconSettings, "SET", "Settings", {
    fullLabel: "Settings",
  });
  wrapper.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  buildTabbedPanel(panel, opts);
  document.body.appendChild(panel);

  container.appendChild(wrapper);

  const openListeners: (() => void)[] = [];

  // Slot registration: opening evicts whatever else holds the top-right
  // corner, fixes the z-order, and closes on outside click / Escape.
  const surface = registerSurface({
    id: "settings",
    slot: "top-right",
    el: () => panel,
    isOpen: () => panel.classList.contains("open"),
    close: () => panel.classList.remove("open"),
  });

  // Toggle panel
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !panel.classList.contains("open");
    panel.classList.toggle("open");
    if (opening) {
      surface.opened();
      for (const fn of openListeners) fn();
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

function buildTabbedPanel(
  panel: HTMLElement,
  opts: CreateSettingsPanelOpts,
): void {
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
  tabBodies.set("layers", buildLayersTab(settings, opts.chartProviders));
  tabBodies.set(
    "navigation",
    buildNavigationTab(
      settings,
      opts.gpsLink,
      opts.openSatelliteDiagnostics,
      opts.openConnectionLog,
      opts.restartSimulator,
    ),
  );

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

/** Small muted section heading within a settings tab. */
function buildSectionHeader(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "settings-section-header";
  h.textContent = text;
  return h;
}

function buildAppearanceTab(
  settings: ReturnType<typeof getSettings>,
): HTMLElement {
  const tab = document.createElement("div");

  tab.appendChild(buildSectionHeader("Display"));

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

  // ── Chart display ───────────────────────────────────────────────

  // Detail level slider
  tab.appendChild(
    buildSliderRow({
      id: "settings-detail-level",
      label: "Detail",
      min: -1,
      max: 2,
      step: 1,
      value: settings.detailLevel,
      format: (v) => DETAIL_LABELS[v as DetailLevel],
      commit: (v) => updateSettings({ detailLevel: v as DetailLevel }),
    }),
  );

  // Chart text size slider
  tab.appendChild(
    buildSliderRow({
      id: "settings-text-scale",
      label: "Chart text size",
      min: 0.75,
      max: 2,
      step: 0.05,
      value: settings.textScale,
      format: (v) => `${Math.round(v * 100)}%`,
      commit: (v) => updateSettings({ textScale: v }),
    }),
  );

  // Chart icon size slider
  tab.appendChild(
    buildSliderRow({
      id: "settings-icon-scale",
      label: "Chart icon size",
      min: 0.75,
      max: 2,
      step: 0.05,
      value: settings.iconScale,
      format: (v) => `${Math.round(v * 100)}%`,
      commit: (v) => updateSettings({ iconScale: v }),
    }),
  );

  // Instrument layout (affects landscape phones; portrait/desktop unchanged)
  const INSTRUMENT_LAYOUT_OPTIONS = [
    { value: "side", label: "Side column" },
    { value: "standard", label: "Top bar" },
  ];
  tab.appendChild(
    buildSelectRow(
      "Landscape instrument layout",
      "settings-instrument-layout",
      INSTRUMENT_LAYOUT_OPTIONS,
      settings.instrumentLayout,
      (v) => updateSettings({ instrumentLayout: v as InstrumentLayout }),
    ),
  );

  // ── Units & measurement ─────────────────────────────────────────
  tab.appendChild(buildSectionHeader("Units"));

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

  // ── Depth shading thresholds ────────────────────────────────────
  tab.appendChild(buildSectionHeader("Depth shading"));
  tab.appendChild(buildDepthThresholdSliders());

  // ── Vessel ──────────────────────────────────────────────────────
  tab.appendChild(buildSectionHeader("Vessel"));

  // Accuracy circle
  tab.appendChild(
    buildCheckboxRow(
      "Accuracy circle",
      "settings-accuracy-circle",
      settings.showAccuracyCircle,
      (v) => updateSettings({ showAccuracyCircle: v }),
    ),
  );

  // ── Screen ──────────────────────────────────────────────────────
  tab.appendChild(buildSectionHeader("Screen & power"));

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

  // Auto-dim when idle
  tab.appendChild(
    buildCheckboxRow(
      "Auto-dim screen when idle (1 min)",
      "settings-auto-dim",
      settings.autoDimWhenIdle,
      (checked) => updateSettings({ autoDimWhenIdle: checked }),
    ),
  );

  // Auto-return to vessel when idle
  tab.appendChild(
    buildCheckboxRow(
      "Close dialogs & recenter when idle (1 min)",
      "settings-auto-return",
      settings.autoReturnWhenIdle,
      (checked) => updateSettings({ autoReturnWhenIdle: checked }),
    ),
  );

  // Re-trigger the screen-timeout warning dialog (useful if previously
  // dismissed). Native-only.
  if (Capacitor.isNativePlatform()) {
    tab.appendChild(
      buildActionRow(
        "Check screen-off timeout",
        "settings-check-screen-timeout",
        "Check",
        () => {
          resetScreenTimeoutDismissal();
          void maybeShowScreenTimeoutWarning();
        },
      ),
    );

    // Volume-key controls: short press zooms, long press locks the screen.
    tab.appendChild(
      buildCheckboxRow(
        "Volume keys zoom chart (adds Lock screen to menu)",
        "settings-volume-keys",
        settings.volumeKeyControls,
        (checked) => updateSettings({ volumeKeyControls: checked }),
      ),
    );
  }

  return tab;
}

function buildLayersTab(
  settings: ReturnType<typeof getSettings>,
  chartProviders: ChartProvidersOpt,
): HTMLElement {
  const tab = document.createElement("div");

  tab.appendChild(buildSectionHeader("Chart"));

  tab.appendChild(
    buildSelectRow(
      "Chart source",
      "settings-chart-source",
      chartProviders.list.map((p) => ({ value: p.id, label: p.name })),
      chartProviders.getActiveId(),
      (v) => chartProviders.setActive(v),
    ),
  );

  // Street underlay (only useful with vector charts)
  tab.appendChild(
    buildSelectRow(
      "Street map under charts",
      "settings-street-underlay",
      [
        { value: "auto", label: "Offline basemap" },
        { value: "osm", label: "OSM (online)" },
        { value: "off", label: "Off" },
      ],
      settings.streetUnderlay,
      (v) => updateSettings({ streetUnderlay: v as StreetUnderlayMode }),
    ),
  );

  // Raster chart (RNC) blend with the vector ENC.
  tab.appendChild(
    buildSelectRow(
      "Raster charts (RNC)",
      "settings-chart-blend",
      [
        { value: "auto", label: "Auto (fill ENC gaps)" },
        { value: "raster", label: "Prefer raster" },
        { value: "vector", label: "Vector only" },
      ],
      settings.chartBlend,
      (v) => updateSettings({ chartBlend: v as ChartBlend }),
    ),
  );

  tab.appendChild(buildSectionHeader("Layers"));

  // Core S-57 groups plus any plugin-registered layer-group toggles.
  for (const { id, label } of getLayerGroups()) {
    const checked = isLayerGroupEnabled(id);
    tab.appendChild(
      buildCheckboxRow(label, `settings-group-${id}`, checked, (v) => {
        const groups = { ...getSettings().layerGroups, [id]: v };
        updateSettings({ layerGroups: groups });
      }),
    );
  }

  // Per-plugin settings sections, rendered from each plugin's declared schema.
  // A section is hidden while its gating layer group is off.
  for (const section of getPluginSettingsSchemas()) {
    const box = document.createElement("div");
    box.appendChild(buildSectionHeader(section.name));
    for (const ctrl of section.schema) {
      box.appendChild(buildPluginControl(section.pluginId, ctrl));
    }
    tab.appendChild(box);

    const gate = section.gate;
    if (gate) {
      const apply = () => {
        box.style.display = isLayerGroupEnabled(gate) ? "" : "none";
      };
      apply();
      onSettingsChange(apply);
    }
  }

  return tab;
}

/** Render one plugin settings control from its declarative schema entry. */
function buildPluginControl(
  pluginId: string,
  ctrl: SettingControl,
): HTMLElement {
  const id = `settings-plugin-${pluginId}-${ctrl.key}`;
  const stored = getPluginSetting(pluginId, ctrl.key);
  const value = stored !== undefined ? stored : ctrl.default;
  const commit = (v: unknown) => setPluginSetting(pluginId, ctrl.key, v);

  switch (ctrl.type) {
    case "toggle":
      return buildCheckboxRow(ctrl.label, id, value === true, commit);
    case "select":
      return buildSelectRow(
        ctrl.label,
        id,
        ctrl.options ?? [],
        String(value ?? ""),
        commit,
      );
    case "text":
      return buildTextRow(ctrl.label, id, String(value ?? ""), commit, {
        placeholder: ctrl.placeholder,
        secret: ctrl.secret,
      });
    default:
      return buildSliderRow({
        id,
        label: ctrl.label,
        min: ctrl.min ?? 0,
        max: ctrl.max ?? 1,
        step: ctrl.step ?? 0.05,
        value: typeof value === "number" ? value : (ctrl.min ?? 0),
        format: ctrl.format ?? ((v) => String(v)),
        commit,
      });
  }
}

function buildTextRow(
  labelText: string,
  id: string,
  value: string,
  onCommit: (value: string) => void,
  opts: { placeholder?: string; secret?: boolean } = {},
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  row.appendChild(label);

  const input = document.createElement("input");
  input.id = id;
  input.type = opts.secret ? "password" : "text";
  input.autocomplete = "off";
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.value = value;
  // Commit on blur/Enter so we don't persist every keystroke.
  const commit = () => onCommit(input.value.trim());
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  row.appendChild(input);
  return row;
}

function buildNavigationTab(
  settings: ReturnType<typeof getSettings>,
  gpsLink: GpsLinkOpt,
  openSatelliteDiagnostics: () => void,
  openConnectionLog: () => void,
  restartSimulator: () => void,
): HTMLElement {
  const tab = document.createElement("div");

  tab.appendChild(buildSectionHeader("GPS"));

  // GPS source — "Device GPS" auto-selects native Capacitor or browser geolocation
  const deviceGpsValue = CapacitorGPSProvider.isAvailable()
    ? "capacitor-gps"
    : "browser-gps";
  const GPS_SOURCES: { value: string; label: string }[] = [
    { value: "none", label: "None" },
    { value: "simulator", label: "Simulator" },
    { value: deviceGpsValue, label: "Device GPS" },
    { value: "web-serial", label: "USB GPS (Serial)" },
    { value: "ble-nmea", label: "Bluetooth GPS (BLE)" },
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

  // BLE link status + actions — shown for Bluetooth GPS, which can drop and not
  // always self-heal. The row shows live connection state, grays out Reconnect
  // when it would do nothing, and offers Reset when the link is stuck.
  const linkRow = buildGpsLinkRow(gpsLink);
  // Live satellite diagnostics — only the BLE pod can stream GSV/GSA on request.
  const satRow = buildActionRow(
    "Satellites",
    "settings-gps-satellites",
    "View",
    () => openSatelliteDiagnostics(),
  );
  // Persistent connection event log — the field-diagnosis record for BLE.
  const logRow = buildActionRow("Event log", "settings-ble-log", "View", () =>
    openConnectionLog(),
  );
  const updateBleRows = (src: string) => {
    const display = src === "ble-nmea" ? "" : "none";
    linkRow.row.style.display = display;
    satRow.style.display = display;
    logRow.style.display = display;
  };
  updateBleRows(settings.gpsSource);
  onSettingsChange((s) => updateBleRows(s.gpsSource));
  tab.appendChild(linkRow.row);
  tab.appendChild(satRow);
  tab.appendChild(logRow);
  // Poll the link state while the panel exists (cheap; the row early-returns when
  // hidden). 1 Hz is enough to catch drops and the stuck-too-long escalation.
  setInterval(linkRow.update, 1000);

  // Simulator speed (shown only when the simulator is the GPS source)
  const SIM_SPEED_OPTIONS = [
    { value: "1", label: "1x" },
    { value: "10", label: "10x" },
    { value: "50", label: "50x" },
    { value: "100", label: "100x" },
  ];
  const simSpeedRow = buildSelectRow(
    "Sim speed",
    "settings-sim-speed",
    SIM_SPEED_OPTIONS,
    String(settings.simulatorSpeed),
    (v) => updateSettings({ simulatorSpeed: Number(v) }),
  );
  const simModeRow = buildSelectRow(
    "Sim source",
    "settings-sim-mode",
    [
      { value: "replay", label: "Replay real sail" },
      { value: "route", label: "Harbor route (6 kn)" },
      { value: "custom", label: 'Route named "SIMULATOR"' },
    ],
    settings.simulatorMode,
    (v) => updateSettings({ simulatorMode: v as SimulatorMode }),
  );
  const simRestartRow = buildActionRow(
    "Restart sim",
    "settings-sim-restart",
    "Restart",
    () => restartSimulator(),
  );
  const simRows = [simSpeedRow, simModeRow, simRestartRow];
  const updateSimRows = (src: string) => {
    const display = src === "simulator" ? "" : "none";
    for (const row of simRows) row.style.display = display;
  };
  updateSimRows(settings.gpsSource);
  onSettingsChange((s) => updateSimRows(s.gpsSource));
  for (const row of simRows) tab.appendChild(row);

  // Signal K server URL (shown only when Signal K is the GPS source)
  const signalkRow = buildTextRow(
    "Signal K URL",
    "settings-signalk-url",
    settings.signalkUrl,
    (v) => updateSettings({ signalkUrl: v }),
    { placeholder: "ws://192.168.1.50:3000/signalk/v1/stream" },
  );
  signalkRow.style.display = settings.gpsSource === "signalk" ? "" : "none";
  onSettingsChange((s) => {
    signalkRow.style.display = s.gpsSource === "signalk" ? "" : "none";
  });
  tab.appendChild(signalkRow);

  // GPS update rate: "Auto" (adaptive — as fast as useful, eased back to save
  // power/e-ink refreshes) or a fixed interval. One control mapped onto the two
  // underlying settings. 0.5/1s are useful with a fast external pod and for
  // power testing; Auto already runs an external pod at full rate on a non-e-ink
  // screen (see NavigationDataManager).
  const GPS_RATE_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "500", label: "0.5s" },
    { value: "1000", label: "1s" },
    { value: "2000", label: "2s" },
    { value: "5000", label: "5s" },
    { value: "10000", label: "10s" },
  ];
  tab.appendChild(
    buildSelectRow(
      "GPS update rate",
      "settings-gps-rate",
      GPS_RATE_OPTIONS,
      settings.gpsRateMode === "adaptive"
        ? "auto"
        : String(settings.manualUpdateIntervalMs),
      (v) => {
        if (v === "auto") {
          updateSettings({ gpsRateMode: "adaptive" });
        } else {
          updateSettings({
            gpsRateMode: "manual",
            manualUpdateIntervalMs: Number(v),
          });
        }
      },
    ),
  );

  // GPS filter strength (adaptive smoothing for jittery hardware)
  const GPS_FILTER_MODES: { value: GpsFilterMode; label: string }[] = [
    { value: "auto", label: "Auto (detect jitter)" },
    { value: "strong", label: "Strong (always smooth)" },
    { value: "normal", label: "Normal (no extra smoothing)" },
  ];
  tab.appendChild(
    buildSelectRow(
      "GPS filter",
      "settings-gps-filter-mode",
      GPS_FILTER_MODES,
      settings.gpsFilterMode,
      (v) => updateSettings({ gpsFilterMode: v as GpsFilterMode }),
    ),
  );

  // Chart mode intentionally has no settings row — the recenter button
  // (bottom-left) cycles modes and persists them itself.

  // ── Course ──────────────────────────────────────────────────────
  tab.appendChild(buildSectionHeader("Course"));

  // Course line duration
  const COURSE_LINE_OPTIONS = [
    { value: "0", label: "Off" },
    { value: "auto", label: "Auto" },
    { value: "5", label: "5 min" },
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
          courseLineDuration:
            v === "auto" ? "auto" : (Number(v) as CourseLineDuration),
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

/**
 * Build depth threshold sliders (shallow and deep).
 * Values are stored in meters but displayed in the user's chosen depth unit.
 * The slider operates in display units and converts back to meters on change.
 */
function buildDepthThresholdSliders(): HTMLElement {
  const container = document.createElement("div");

  // Piecewise-linear slider: first half covers 0–KNEE_METERS,
  // second half covers KNEE_METERS–MAX_METERS, giving finer control
  // at shallow depths where precision matters most.
  const MAX_METERS = 30;
  const KNEE_METERS = 6; // ~20ft — midpoint of slider
  const SLIDER_MAX = 1000; // internal slider resolution

  function currentUnit(): DepthUnit {
    return getSettings().depthUnit;
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

  /** Convert meters to display value in the user's depth unit. */
  function metersToDisplay(m: number, unit: DepthUnit): number {
    return Math.round(convertDepth(m, unit) * 10) / 10;
  }

  /** Convert display value back to meters. */
  function displayToMeters(d: number, unit: DepthUnit): number {
    return d / depthConversionFactor(unit);
  }

  /** Map meters (0–MAX_METERS) to slider position (0–SLIDER_MAX), piecewise linear. */
  function metersToSlider(m: number): number {
    if (m <= KNEE_METERS) {
      return (m / KNEE_METERS) * (SLIDER_MAX / 2);
    }
    return (
      SLIDER_MAX / 2 +
      ((m - KNEE_METERS) / (MAX_METERS - KNEE_METERS)) * (SLIDER_MAX / 2)
    );
  }

  /** Map slider position (0–SLIDER_MAX) back to meters, piecewise linear. */
  function sliderToMeters(pos: number): number {
    if (pos <= SLIDER_MAX / 2) {
      return (pos / (SLIDER_MAX / 2)) * KNEE_METERS;
    }
    return (
      KNEE_METERS +
      ((pos - SLIDER_MAX / 2) / (SLIDER_MAX / 2)) * (MAX_METERS - KNEE_METERS)
    );
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

  // Safety depth slider
  const safetyRow = document.createElement("div");
  safetyRow.className = "settings-row";
  const safetyLabel = document.createElement("label");
  safetyLabel.htmlFor = "settings-safety-depth";
  safetyLabel.textContent = "Safety";
  safetyRow.appendChild(safetyLabel);

  const safetyGroup = document.createElement("div");
  safetyGroup.className = "settings-slider-group";
  const safetySlider = document.createElement("input");
  safetySlider.type = "range";
  safetySlider.id = "settings-safety-depth";
  const safetyInput = document.createElement("input");
  safetyInput.type = "number";

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
  const safetySuffix = document.createElement("span");
  safetySuffix.className = "unit-suffix";
  const deepSuffix = document.createElement("span");
  deepSuffix.className = "unit-suffix";

  let syncing = false;

  function syncSliders() {
    syncing = true;
    const unit = currentUnit();
    const step = stepForUnit(unit);
    const maxDisplay = metersToDisplay(MAX_METERS, unit);
    const s = getSettings();
    const unitStr = depthUnitLabel(unit);

    // Sliders use internal 0–SLIDER_MAX range with piecewise mapping
    shallowSlider.min = "0";
    shallowSlider.max = String(SLIDER_MAX);
    shallowSlider.step = "1";
    shallowSlider.value = String(Math.round(metersToSlider(s.shallowDepth)));
    shallowInput.min = "0";
    shallowInput.max = String(maxDisplay);
    shallowInput.step = String(step);
    shallowInput.value = String(metersToDisplay(s.shallowDepth, unit));
    shallowSuffix.textContent = unitStr;

    safetySlider.min = "0";
    safetySlider.max = String(SLIDER_MAX);
    safetySlider.step = "1";
    safetySlider.value = String(Math.round(metersToSlider(s.safetyDepth)));
    safetyInput.min = "0";
    safetyInput.max = String(maxDisplay);
    safetyInput.step = String(step);
    safetyInput.value = String(metersToDisplay(s.safetyDepth, unit));
    safetySuffix.textContent = unitStr;

    deepSlider.min = "0";
    deepSlider.max = String(SLIDER_MAX);
    deepSlider.step = "1";
    deepSlider.value = String(Math.round(metersToSlider(s.deepDepth)));
    deepInput.min = "0";
    deepInput.max = String(maxDisplay);
    deepInput.step = String(step);
    deepInput.value = String(metersToDisplay(s.deepDepth, unit));
    deepSuffix.textContent = unitStr;
    syncing = false;
  }

  syncSliders();

  // Ordering rules:
  // - Moving a shallower slider UP pushes deeper sliders along
  // - Moving a deeper slider DOWN clamps at the next shallower value
  function applyShallowMeters(meters: number) {
    const s = getSettings();
    if (meters > s.deepDepth) {
      updateSettings({
        shallowDepth: meters,
        safetyDepth: meters,
        deepDepth: meters,
      });
    } else if (meters > s.safetyDepth) {
      updateSettings({ shallowDepth: meters, safetyDepth: meters });
    } else {
      updateSettings({ shallowDepth: meters });
    }
  }

  function applySafetyMeters(meters: number) {
    const s = getSettings();
    // Clamp at shallow (don't push shallow down)
    const clamped = Math.max(meters, s.shallowDepth);
    if (clamped > s.deepDepth) {
      updateSettings({ safetyDepth: clamped, deepDepth: clamped });
    } else {
      updateSettings({ safetyDepth: clamped });
    }
  }

  function applyDeepMeters(meters: number) {
    const s = getSettings();
    // Clamp at safety (don't push safety or shallow down)
    const clamped = Math.max(meters, s.safetyDepth);
    updateSettings({ deepDepth: clamped });
  }

  // Snap meters to the nearest display step so we don't fire redundant updates
  function snapMeters(meters: number): number {
    const unit = currentUnit();
    const step = stepForUnit(unit);
    const factor = depthConversionFactor(unit);
    const display = Math.round((meters * factor) / step) * step;
    return display / factor;
  }

  // Arrow key handler: step by one display unit instead of raw slider ticks
  function handleArrowKey(
    e: KeyboardEvent,
    applyFn: (m: number) => void,
    getCurrentMeters: () => number,
  ) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = stepForUnit(currentUnit());
    const factor = depthConversionFactor(currentUnit());
    const currentDisplay = getCurrentMeters() * factor;
    const delta = e.key === "ArrowRight" ? step : -step;
    const newDisplay = Math.max(0, currentDisplay + delta);
    const newMeters = newDisplay / factor;
    applyFn(snapMeters(newMeters));
  }

  shallowSlider.addEventListener("keydown", (e) =>
    handleArrowKey(e, applyShallowMeters, () => getSettings().shallowDepth),
  );
  safetySlider.addEventListener("keydown", (e) =>
    handleArrowKey(e, applySafetyMeters, () => getSettings().safetyDepth),
  );
  deepSlider.addEventListener("keydown", (e) =>
    handleArrowKey(e, applyDeepMeters, () => getSettings().deepDepth),
  );

  // Slider handlers: convert slider position → meters, snap, skip if unchanged.
  // Guard with `syncing` (syncSliders setting .value re-fires input events)
  // and use tolerance to avoid floating-point churn.
  // On e-ink, drags only preview into the number input; the commit (and its
  // slow full-chart refresh) waits for release ("change").
  const DEPTH_CHANGE_THRESHOLD_M = 1e-1;

  function wireDepthSlider(
    slider: HTMLInputElement,
    input: HTMLInputElement,
    applyFn: (m: number) => void,
    getMeters: () => number,
  ): void {
    const commit = () => {
      if (syncing) return;
      const m = snapMeters(sliderToMeters(Number(slider.value)));
      if (Math.abs(m - getMeters()) > DEPTH_CHANGE_THRESHOLD_M) applyFn(m);
    };
    slider.addEventListener("input", () => {
      if (syncing) return;
      if (deferSliderCommits()) {
        const m = snapMeters(sliderToMeters(Number(slider.value)));
        input.value = String(metersToDisplay(m, currentUnit()));
        return;
      }
      commit();
    });
    slider.addEventListener("change", commit);
  }

  wireDepthSlider(
    shallowSlider,
    shallowInput,
    applyShallowMeters,
    () => getSettings().shallowDepth,
  );
  wireDepthSlider(
    safetySlider,
    safetyInput,
    applySafetyMeters,
    () => getSettings().safetyDepth,
  );
  wireDepthSlider(
    deepSlider,
    deepInput,
    applyDeepMeters,
    () => getSettings().deepDepth,
  );

  /** −/+ stepper: one display-unit step (same as arrow keys), committed. */
  function depthStepButton(
    dir: -1 | 1,
    applyFn: (m: number) => void,
    getMeters: () => number,
  ): HTMLButtonElement {
    return buildStepButton(dir, () => {
      const unit = currentUnit();
      const factor = depthConversionFactor(unit);
      const newDisplay = Math.max(
        0,
        getMeters() * factor + dir * stepForUnit(unit),
      );
      applyFn(snapMeters(newDisplay / factor));
    });
  }

  // Number input handlers: convert display units → meters
  // Guard with syncing + epsilon to prevent re-fire when syncSliders() sets .value
  // (some browsers fire change asynchronously after syncing flag is cleared)
  shallowInput.addEventListener("change", () => {
    if (syncing) return;
    const m = displayToMeters(Number(shallowInput.value), currentUnit());
    if (Math.abs(m - getSettings().shallowDepth) > DEPTH_CHANGE_THRESHOLD_M)
      applyShallowMeters(m);
  });

  safetyInput.addEventListener("change", () => {
    if (syncing) return;
    const m = displayToMeters(Number(safetyInput.value), currentUnit());
    if (Math.abs(m - getSettings().safetyDepth) > DEPTH_CHANGE_THRESHOLD_M)
      applySafetyMeters(m);
  });

  deepInput.addEventListener("change", () => {
    if (syncing) return;
    const m = displayToMeters(Number(deepInput.value), currentUnit());
    if (Math.abs(m - getSettings().deepDepth) > DEPTH_CHANGE_THRESHOLD_M)
      applyDeepMeters(m);
  });

  // Re-sync when any relevant setting changes (unit or thresholds)
  onSettingsChange(() => {
    if (!syncing) syncSliders();
  });

  const shallowM = () => getSettings().shallowDepth;
  const safetyM = () => getSettings().safetyDepth;
  const deepM = () => getSettings().deepDepth;
  shallowGroup.append(
    depthStepButton(-1, applyShallowMeters, shallowM),
    shallowSlider,
    depthStepButton(1, applyShallowMeters, shallowM),
    shallowInput,
    shallowSuffix,
  );
  shallowRow.appendChild(shallowGroup);
  safetyGroup.append(
    depthStepButton(-1, applySafetyMeters, safetyM),
    safetySlider,
    depthStepButton(1, applySafetyMeters, safetyM),
    safetyInput,
    safetySuffix,
  );
  safetyRow.appendChild(safetyGroup);
  deepGroup.append(
    depthStepButton(-1, applyDeepMeters, deepM),
    deepSlider,
    depthStepButton(1, applyDeepMeters, deepM),
    deepInput,
    deepSuffix,
  );
  deepRow.appendChild(deepGroup);

  container.append(shallowRow, safetyRow, deepRow);
  return container;
}

/**
 * On e-ink, defer chart-affecting slider commits until release — every
 * intermediate value would cost a (slow) full panel refresh, which makes
 * the slider impossible to position accurately.
 */
function deferSliderCommits(): boolean {
  return getSettings().displayTheme === "eink";
}

/** Small −/+ stepper button: one discrete, committed step per tap. */
function buildStepButton(dir: -1 | 1, onStep: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-step-btn";
  btn.textContent = dir < 0 ? "−" : "+";
  btn.setAttribute("aria-label", dir < 0 ? "Decrease" : "Increase");
  btn.addEventListener("click", onStep);
  return btn;
}

/**
 * Settings row with a slider flanked by −/+ steppers and a value label.
 * Dragging updates the label live; the chart-affecting commit fires on
 * every input on fast displays but only on release for e-ink. Steppers
 * always commit immediately — one tap, one discrete refresh.
 */
function buildSliderRow(opts: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  commit: (v: number) => void;
}): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.htmlFor = opts.id;
  label.textContent = opts.label;
  row.appendChild(label);

  const group = document.createElement("div");
  group.className = "settings-slider-group";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = opts.id;
  slider.min = String(opts.min);
  slider.max = String(opts.max);
  slider.step = String(opts.step);
  slider.value = String(opts.value);

  const valueLabel = document.createElement("span");
  valueLabel.textContent = opts.format(opts.value);

  const current = () => Number.parseFloat(slider.value);
  const apply = (v: number, commitNow: boolean) => {
    valueLabel.textContent = opts.format(v);
    if (commitNow) opts.commit(v);
  };
  // Debounce live commits while dragging: the label updates every tick, but the
  // (rebuild-triggering) commit fires at most every 120 ms, with a guaranteed
  // final commit on release. E-ink defers entirely to release.
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  const SLIDER_COMMIT_DEBOUNCE_MS = 120;
  slider.addEventListener("input", () => {
    const v = current();
    valueLabel.textContent = opts.format(v);
    if (deferSliderCommits()) return;
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => opts.commit(v), SLIDER_COMMIT_DEBOUNCE_MS);
  });
  slider.addEventListener("change", () => {
    if (commitTimer) clearTimeout(commitTimer);
    apply(current(), true);
  });

  const stepBy = (dir: -1 | 1) => {
    // Snap to the step grid and trim float dust (0.05 steps)
    const stepped = current() + dir * opts.step;
    const v = Number(
      Math.min(opts.max, Math.max(opts.min, stepped)).toFixed(4),
    );
    slider.value = String(v);
    apply(v, true);
  };
  group.append(
    buildStepButton(-1, () => stepBy(-1)),
    slider,
    buildStepButton(1, () => stepBy(1)),
    valueLabel,
  );
  row.appendChild(group);
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

/** Settings row with a label and a single action button on the right. */
function buildActionRow(
  labelText: string,
  id: string,
  buttonText: string,
  onClick: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  row.appendChild(label);

  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.className = "settings-action-btn";
  btn.textContent = buttonText;
  btn.addEventListener("click", onClick);
  row.appendChild(btn);

  return row;
}

// Reconnecting longer than this (the provider's watchdog also converts a silent
// "connected" link into reconnecting) is treated as stuck → offer Reset.
const GPS_LINK_STUCK_MS = 15000;

/**
 * BLE link row: live ✓/⟳/✕ status, a Reconnect button greyed out while already
 * connected, and a Reset button that appears only when the link is stuck. Call
 * the returned `update` on a timer to refresh state.
 */
function buildGpsLinkRow(gpsLink: GpsLinkOpt): {
  row: HTMLElement;
  update: () => void;
} {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.textContent = "BLE link";
  row.appendChild(label);

  const controls = document.createElement("div");
  controls.className = "settings-link-controls";

  const status = document.createElement("span");
  status.className = "settings-link-status";

  const reconnectBtn = document.createElement("button");
  reconnectBtn.type = "button";
  reconnectBtn.className = "settings-action-btn";
  reconnectBtn.textContent = "Reconnect";
  reconnectBtn.addEventListener("click", () => gpsLink.reconnect());

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "settings-action-btn";
  resetBtn.textContent = "Reset";
  resetBtn.style.display = "none";
  resetBtn.addEventListener("click", () => gpsLink.reset());

  // Always enabled — it's the escape hatch when the saved device is stale
  // (reflashed pod with a new MAC), including while "reconnecting" forever.
  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.className = "settings-action-btn";
  changeBtn.textContent = "Change…";
  changeBtn.addEventListener("click", () => gpsLink.changeDevice());

  controls.append(status, reconnectBtn, resetBtn, changeBtn);
  row.appendChild(controls);

  let reconnectingSince = 0;

  const update = () => {
    if (row.style.display === "none") return; // not the BLE source — skip
    const connected = gpsLink.isConnected();
    const reconnecting = gpsLink.isReconnecting();

    if (connected) {
      status.textContent = "✓ Connected";
      status.className = "settings-link-status settings-link-ok";
    } else if (reconnecting) {
      status.textContent = "⟳ Reconnecting…";
      status.className = "settings-link-status settings-link-warn";
    } else {
      status.textContent = "✕ Disconnected";
      status.className = "settings-link-status settings-link-bad";
    }

    // Reconnect is a no-op while connected — gray it out for honest feedback.
    reconnectBtn.disabled = connected;

    if (!connected && reconnecting) {
      if (!reconnectingSince) reconnectingSince = Date.now();
    } else {
      reconnectingSince = 0;
    }
    const stuck =
      reconnectingSince > 0 &&
      Date.now() - reconnectingSince > GPS_LINK_STUCK_MS;
    resetBtn.style.display = stuck ? "" : "none";
  };

  update();
  return { row, update };
}
