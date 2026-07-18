/**
 * GPS provider for Bluetooth Classic SPP NMEA receivers (e.g. Garmin GLO) on
 * native builds, via the BluetoothSerial Capacitor plugin. These devices
 * stream NMEA 0183 over RFCOMM — a transport the BLE path can't reach.
 *
 * Mirrors CapacitorBLENMEAProvider's shape: the reconnect state machine lives
 * in ReconnectingTransport, sentence assembly in NMEAStream; this class owns
 * the plugin transport, the paired-device chooser, and Bluetooth-off handling.
 * Differences from the BLE pod:
 * - Classic devices pair in Android settings, so the "picker" is an in-app
 *   list of bonded devices, not a native scan dialog (no gesture required).
 * - The receiver streams GSV/GSA on its own — no "SAT" command to send, so
 *   requestSatelliteData is a no-op and satellite data is always parsed.
 * - The plugin has no adapter-state events; Bluetooth-off is detected on
 *   failure and polled until the radio returns.
 */

import { BluetoothSerial } from "../plugins/BluetoothSerial";
import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationDataCallback,
  NavigationDataProvider,
  SatelliteDiagnostics,
  SatelliteStatusCallback,
} from "./NavigationData";
import { NMEAStream } from "./nmea-stream";
import type { ProviderNotice } from "./ProviderNotice";
import { ReconnectingTransport } from "./ReconnectingTransport";
import {
  clearSavedSppDevice,
  loadSavedSppDevice,
  type SavedSppDevice,
  saveSppDevice,
} from "./sppDeviceStore";

/** Poll the adapter state at this interval while suspended for Bluetooth-off. */
const BT_OFF_POLL_MS = 5000;

/** Chooser injected by main.ts (an in-app dialog; null = cancelled). */
export type SppDeviceChooser = (
  devices: { deviceId: string; name: string }[],
) => Promise<{ deviceId: string; name: string } | null>;

export class CapacitorSPPNMEAProvider
  implements NavigationDataProvider, SatelliteDiagnostics
{
  readonly id = "bt-spp";
  readonly name = "Bluetooth GPS (NMEA)";
  readonly external = true;

  private listeners: NavigationDataCallback[] = [];
  private satListeners: SatelliteStatusCallback[] = [];
  private device: SavedSppDevice | null = null;
  private pluginListenersReady = false;
  private btPollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly core: ReconnectingTransport;
  private readonly stream: NMEAStream;
  private readonly chooser: SppDeviceChooser;
  private readonly onNotice?: (notice: ProviderNotice) => void;

  constructor(
    chooser: SppDeviceChooser,
    onNotice?: (notice: ProviderNotice) => void,
  ) {
    this.chooser = chooser;
    this.onNotice = onNotice;
    this.stream = new NMEAStream(
      "bt-spp",
      (data) => {
        for (const fn of this.listeners) fn(data);
      },
      (status) => {
        for (const fn of this.satListeners) fn(status);
      },
    );
    this.core = new ReconnectingTransport(
      { providerId: this.id, logLabel: "SPP GPS" },
      {
        establish: () => this.openLink(),
        onEstablished: () => this.handleEstablished(),
        teardown: () => {
          void BluetoothSerial.disconnect().catch(() => {});
        },
        canAttempt: () => this.device !== null,
        escalateRecovery: () => this.detectBtOff(),
        attemptDetail: (cause) => this.attemptDetail(cause),
      },
    );
  }

  isConnected(): boolean {
    return this.core.isConnected();
  }

  lastRawDataMs(): number {
    return this.core.lastRawDataMs();
  }

  isReconnecting(): boolean {
    return this.core.isReconnecting();
  }

  /** Background pacing: stretch reconnect delays while hidden and not recording. */
  setReconnectPacing(relaxed: boolean): void {
    this.core.setPacing(relaxed);
  }

  connect(): void {
    if (!this.core.noteConnectRequested()) return;
    void this.startConnect();
  }

  disconnect(): void {
    this.core.noteDisconnectRequested();
    this.device = null;
    this.stream.reset();
    this.stopBtPoll();
    void BluetoothSerial.disconnect().catch(() => {});
  }

  /**
   * Manual reconnect (UI button). With a device already chosen (in memory or
   * persisted), cancel any pending backoff and retry immediately; with no
   * device at all, fall back to the normal connect, which shows the chooser.
   */
  async reconnect(): Promise<void> {
    this.core.claimIntent();
    if (!this.device) this.device = loadSavedSppDevice();
    if (this.device) {
      try {
        connectionLog.log(
          this.id,
          "connect-attempt",
          this.attemptDetail("manual"),
        );
        await this.core.runEstablish("manual");
        return;
      } catch (err) {
        console.warn("SPP GPS manual reconnect failed, re-picking:", err);
        if (await this.detectBtOff()) return;
        this.device = null;
      }
    }
    await this.pickAndConnect();
  }

  /** Forget the saved device and re-run the chooser. */
  async pickNewDevice(): Promise<void> {
    clearSavedSppDevice();
    this.device = null;
    void BluetoothSerial.disconnect().catch(() => {});
    this.core.claimIntent();
    await this.pickAndConnect();
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /** The receiver streams GSV/GSA unconditionally — nothing to request. */
  requestSatelliteData(_enable: boolean): void {}

  subscribeSatelliteStatus(callback: SatelliteStatusCallback): void {
    this.satListeners.push(callback);
  }

  unsubscribeSatelliteStatus(callback: SatelliteStatusCallback): void {
    const idx = this.satListeners.indexOf(callback);
    if (idx >= 0) this.satListeners.splice(idx, 1);
  }

  private attemptDetail(cause: string): string {
    return `${this.device?.deviceId ?? "?"} (${cause})`;
  }

  /** Full connect flow: saved-device rehydrate (silent) → chooser fallback. */
  private async startConnect(): Promise<void> {
    const saved = loadSavedSppDevice();
    if (saved) {
      this.device = saved;
      connectionLog.log(
        this.id,
        "connect-attempt",
        this.attemptDetail("restored"),
      );
      try {
        await this.core.runEstablish("restored");
      } catch (err) {
        console.warn("SPP GPS restored-device connect failed:", err);
        await this.core.noteEstablishFailed(err);
      }
      return;
    }
    await this.pickAndConnect();
  }

  /**
   * Show the bonded-device chooser and connect to the choice. A cancelled or
   * empty chooser drops the intent — loudly (log + notice) — since retrying
   * would just re-show the dialog.
   */
  private async pickAndConnect(): Promise<void> {
    let devices: { deviceId: string; name: string }[];
    try {
      devices = (await BluetoothSerial.getBondedDevices()).devices;
    } catch (err) {
      connectionLog.log(this.id, "error", `bonded devices: ${String(err)}`);
      if (!(await this.detectBtOff())) {
        this.onNotice?.({ kind: "connect-failed", detail: String(err) });
        this.core.dropIntent();
      }
      return;
    }
    if (devices.length === 0) {
      connectionLog.log(this.id, "error", "no bonded devices");
      this.onNotice?.({
        kind: "connect-failed",
        detail: "no paired devices — pair the GPS in Android settings first",
      });
      this.core.dropIntent();
      return;
    }
    connectionLog.log(this.id, "picker-shown");
    const choice = await this.chooser(devices);
    if (!choice) {
      connectionLog.log(this.id, "picker-cancelled");
      this.onNotice?.({ kind: "picker-cancelled", detail: "cancelled" });
      this.core.dropIntent();
      return;
    }
    this.device = choice;
    saveSppDevice(choice);
    connectionLog.log(
      this.id,
      "device-selected",
      `${choice.name} ${choice.deviceId}`,
    );
    try {
      connectionLog.log(
        this.id,
        "connect-attempt",
        this.attemptDetail("initial"),
      );
      await this.core.runEstablish("initial");
    } catch (err) {
      console.warn("SPP GPS connect failed, retrying:", err);
      connectionLog.log(this.id, "error", `connect: ${String(err)}`);
      await this.core.noteEstablishFailed(err);
    }
  }

  /** Connect on the already-chosen device (initial connect and every retry). */
  private async openLink(): Promise<void> {
    const id = this.device?.deviceId;
    if (!id) throw new Error("no device");
    await this.ensurePluginListeners();
    // Clear any half-open native socket first — the plugin holds one at most.
    await BluetoothSerial.disconnect().catch(() => {});
    await BluetoothSerial.connect({ deviceId: id });
  }

  // Register the plugin event listeners once, before the first connect, so no
  // data races the subscription. They persist across reconnects.
  private async ensurePluginListeners(): Promise<void> {
    if (this.pluginListenersReady) return;
    await BluetoothSerial.addListener("data", (event) => {
      this.core.noteData();
      this.stream.push(event.data);
    });
    await BluetoothSerial.addListener("disconnected", () => {
      this.core.noteLinkDropped();
    });
    this.pluginListenersReady = true;
  }

  private handleEstablished(): void {
    this.stream.reset();
    this.stopBtPoll();
    connectionLog.log(this.id, "connected", this.device?.name);
    this.onNotice?.({ kind: "connected" });
  }

  /**
   * A connect failure may really be "Bluetooth is off". Detect it so the
   * failure surfaces as the bt-off banner + a resume poll instead of a futile
   * backoff loop. Returns true when the core should idle (suspended).
   */
  private async detectBtOff(): Promise<boolean> {
    const enabled = await BluetoothSerial.isEnabled()
      .then((r) => r.enabled)
      .catch(() => true);
    if (enabled) return false;
    if (!this.core.isSuspended()) {
      this.core.suspend();
      connectionLog.log(this.id, "bt-disabled", "detected on failure");
      this.onNotice?.({ kind: "bt-off" });
    }
    this.scheduleBtPoll();
    return true;
  }

  // The plugin has no adapter-state events, so while suspended poll for the
  // radio coming back; on bt-on, resume and re-run the connect flow.
  private scheduleBtPoll(): void {
    if (this.btPollTimer !== null) return;
    this.btPollTimer = setTimeout(() => {
      this.btPollTimer = null;
      void this.pollBtState();
    }, BT_OFF_POLL_MS);
  }

  private async pollBtState(): Promise<void> {
    if (!this.core.isSuspended()) return;
    const enabled = await BluetoothSerial.isEnabled()
      .then((r) => r.enabled)
      .catch(() => false);
    if (enabled) {
      this.core.resume();
      connectionLog.log(this.id, "bt-enabled");
      this.onNotice?.({ kind: "bt-on" });
      if (this.core.wantConnected) void this.startConnect();
    } else {
      this.scheduleBtPoll();
    }
  }

  private stopBtPoll(): void {
    if (this.btPollTimer !== null) {
      clearTimeout(this.btPollTimer);
      this.btPollTimer = null;
    }
  }
}
