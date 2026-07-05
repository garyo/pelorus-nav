/**
 * GPS provider for the BLE NUS pod on native (Capacitor) builds — the Android
 * WebView has no Web Bluetooth, so we use @capacitor-community/bluetooth-le.
 *
 * Mirrors BLENMEAProvider (Web Bluetooth): same Nordic UART Service, same NMEA
 * stream, same id ("ble-nmea") and gesture model (selecting the provider in
 * Settings triggers the native device picker). Only the transport API differs,
 * so main.ts registers this on native and the Web Bluetooth one on the web.
 *
 * Resilience (field-tested the hard way):
 * - The chosen device persists across app restarts (bleDeviceStore), so
 *   startup reconnects silently — no picker.
 * - Bluetooth-off is detected and surfaced via the notice callback instead of
 *   failing silently; the connect intent survives and resumes when BT returns.
 * - Lifecycle events land in the persistent connectionLog for field diagnosis.
 *
 * The reconnect state machine (intent, backoff, silence watchdog) lives in
 * ReconnectingTransport; this class owns the plugin transport, the picker
 * flows, and Bluetooth on/off handling.
 */

import { BleClient, type BleDevice } from "@capacitor-community/bluetooth-le";
import {
  clearSavedBleDevice,
  loadSavedBleDevice,
  saveBleDevice,
} from "./bleDeviceStore";
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

// Nordic UART Service UUIDs (lowercase, as the plugin expects).
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // central → peripheral (write)
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // peripheral → central (notify)

// Retry the Bluetooth-enabled notification registration on this interval
// until it succeeds — without it, bt-off/bt-on transitions are invisible
// and only a full disconnect/reconnect can un-strand the provider.
const ENABLED_WATCH_RETRY_MS = 5000;

/** @deprecated Use ProviderNotice — kept as an alias during migration. */
export type BleNotice = ProviderNotice;

export class CapacitorBLENMEAProvider
  implements NavigationDataProvider, SatelliteDiagnostics
{
  readonly id = "ble-nmea";
  readonly name = "Bluetooth GPS (BLE)";

  private listeners: NavigationDataCallback[] = [];
  private satListeners: SatelliteStatusCallback[] = [];
  private device: BleDevice | null = null;
  // The deviceId the last establish connected — what teardown must release
  // when disconnect() raced the establish (this.device may be gone).
  private linkDeviceId: string | null = null;
  private satWanted = false;
  private enabledWatchStarted = false;
  private enabledWatchRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly core: ReconnectingTransport;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly stream: NMEAStream;
  private readonly onNotice?: (notice: BleNotice) => void;

  constructor(onNotice?: (notice: BleNotice) => void) {
    this.onNotice = onNotice;
    this.stream = new NMEAStream(
      "ble-nmea",
      (data) => {
        for (const fn of this.listeners) fn(data);
      },
      (status) => {
        for (const fn of this.satListeners) fn(status);
      },
    );
    this.core = new ReconnectingTransport(
      { providerId: this.id, logLabel: "Capacitor BLE GPS" },
      {
        establish: () => this.openLink(),
        onEstablished: () => this.handleEstablished(),
        teardown: () => this.teardownLink(),
        canAttempt: () => this.device !== null,
        escalateRecovery: () => this.detectBtOff(),
        attemptDetail: (cause) => this.attemptDetail(cause),
      },
    );
  }

  isConnected(): boolean {
    return this.core.isConnected();
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
    const id = this.device?.deviceId;
    this.device = null;
    this.stream.reset();
    if (id) {
      BleClient.stopNotifications(id, NUS_SERVICE, NUS_TX).catch(() => {});
      BleClient.disconnect(id).catch(() => {});
    }
    if (this.enabledWatchRetryTimer !== null) {
      clearTimeout(this.enabledWatchRetryTimer);
      this.enabledWatchRetryTimer = null;
    }
    if (this.enabledWatchStarted) {
      this.enabledWatchStarted = false;
      BleClient.stopEnabledNotifications().catch(() => {});
    }
  }

  /**
   * Manual reconnect (UI button). With a device already chosen (in memory or
   * persisted), cancel any pending backoff and retry immediately — no picker.
   * With no device at all, fall back to the normal connect, which shows the
   * native picker.
   */
  async reconnect(): Promise<void> {
    this.core.claimIntent();
    if (!this.device) {
      const saved = loadSavedBleDevice();
      if (saved) {
        this.device = { deviceId: saved.deviceId, name: saved.name };
      }
    }
    if (this.device) {
      try {
        connectionLog.log(
          this.id,
          "connect-attempt",
          this.attemptDetail("manual"),
        );
        await this.core.runEstablish("manual"); // reuse the chosen device — no picker
        return;
      } catch (err) {
        console.warn(
          "Capacitor BLE GPS manual reconnect: reuse failed, re-picking:",
          err,
        );
        if (await this.detectBtOff()) return;
        this.device = null;
      }
    }
    await this.pickAndConnect(); // shows the native picker
  }

  /** Forget the saved pod and re-run the picker (the stale-MAC escape hatch). */
  async pickNewDevice(): Promise<void> {
    clearSavedBleDevice();
    const id = this.device?.deviceId;
    if (id) {
      BleClient.stopNotifications(id, NUS_SERVICE, NUS_TX).catch(() => {});
      BleClient.disconnect(id).catch(() => {});
    }
    this.device = null;
    this.core.claimIntent();
    await this.pickAndConnect();
  }

  /**
   * Ask Android to enable Bluetooth (system dialog); falls back to opening
   * the Bluetooth settings screen. Wired to the "Turn On" banner action.
   */
  async promptEnableBluetooth(): Promise<void> {
    try {
      await BleClient.requestEnable();
    } catch {
      await BleClient.openBluetoothSettings().catch(() => {});
    }
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  requestSatelliteData(enable: boolean): void {
    this.satWanted = enable;
    this.sendSatCommand(enable);
  }

  subscribeSatelliteStatus(callback: SatelliteStatusCallback): void {
    this.satListeners.push(callback);
  }

  unsubscribeSatelliteStatus(callback: SatelliteStatusCallback): void {
    const idx = this.satListeners.indexOf(callback);
    if (idx >= 0) this.satListeners.splice(idx, 1);
  }

  // Tell the pod to start/stop streaming GSV/GSA. No-op (logged) if the link is
  // down; the pod also auto-reverts so a missed "SAT 0" can't strand it on.
  private sendSatCommand(enable: boolean): void {
    const id = this.device?.deviceId;
    if (!id || !this.core.isConnected()) return;
    const bytes = this.encoder.encode(`SAT ${enable ? 1 : 0}\n`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    BleClient.write(id, NUS_SERVICE, NUS_RX, view).catch((err) => {
      console.warn("Capacitor BLE GPS satellite command failed:", err);
    });
  }

  private attemptDetail(cause: string): string {
    return `${this.device?.deviceId ?? "?"} (${cause})`;
  }

  /**
   * Full connect flow: initialize → Bluetooth-enabled check → saved-device
   * rehydrate (silent) → picker fallback (first-ever use).
   */
  private async startConnect(): Promise<void> {
    try {
      await BleClient.initialize();
    } catch (err) {
      connectionLog.log(this.id, "error", `initialize: ${String(err)}`);
      this.onNotice?.({ kind: "connect-failed", detail: String(err) });
      this.core.dropIntent();
      return;
    }
    if (!(await this.ensureEnabledWatch())) return; // BT off: intent kept
    const saved = loadSavedBleDevice();
    if (saved) {
      // Silent startup rehydrate — connect by the persisted deviceId, no
      // picker. getDevices just materializes the BleDevice; a failure there
      // is non-fatal (Android can connect directly by id).
      const found = await BleClient.getDevices([saved.deviceId]).catch(
        () => [] as BleDevice[],
      );
      this.device = found[0] ?? { deviceId: saved.deviceId, name: saved.name };
      connectionLog.log(
        this.id,
        "connect-attempt",
        this.attemptDetail("restored"),
      );
      try {
        await this.core.runEstablish("restored");
      } catch (err) {
        console.warn("Capacitor BLE GPS restored-device connect failed:", err);
        await this.core.noteEstablishFailed(err);
      }
      return;
    }
    await this.pickAndConnect();
  }

  /**
   * Start the Bluetooth enabled/disabled watch (once) and check current state.
   * Returns whether Bluetooth is enabled. When it's off, surface the notice
   * and keep the intent — onEnabledChanged resumes when BT comes back.
   */
  private async ensureEnabledWatch(): Promise<boolean> {
    if (!this.enabledWatchStarted && this.enabledWatchRetryTimer === null) {
      try {
        await BleClient.startEnabledNotifications((value) =>
          this.onEnabledChanged(value),
        );
        this.enabledWatchStarted = true;
      } catch (err) {
        console.warn("Capacitor BLE GPS: enabled watch failed, retrying:", err);
        this.scheduleEnabledWatchRetry();
      }
    }
    const enabled = await BleClient.isEnabled().catch(() => true);
    if (!enabled) {
      this.core.suspend();
      connectionLog.log(this.id, "bt-disabled", "at connect");
      this.onNotice?.({ kind: "bt-off" });
    } else if (this.core.isSuspended()) {
      this.core.resume();
    }
    return enabled;
  }

  private scheduleEnabledWatchRetry(): void {
    this.enabledWatchRetryTimer = setTimeout(() => {
      this.enabledWatchRetryTimer = null;
      void this.retryEnabledWatch();
    }, ENABLED_WATCH_RETRY_MS);
  }

  // A failed registration means bt-off/bt-on transitions are invisible until
  // this succeeds. Once it does, apply the current state as if the
  // notification had just fired — a transition that happened while
  // unregistered must not leave the provider stranded.
  private async retryEnabledWatch(): Promise<void> {
    try {
      await BleClient.startEnabledNotifications((value) =>
        this.onEnabledChanged(value),
      );
      this.enabledWatchStarted = true;
      this.onEnabledChanged(await BleClient.isEnabled().catch(() => true));
    } catch (err) {
      console.warn("Capacitor BLE GPS: enabled watch failed, retrying:", err);
      this.scheduleEnabledWatchRetry();
    }
  }

  private onEnabledChanged(enabled: boolean): void {
    if (enabled) {
      this.core.resume();
      connectionLog.log(this.id, "bt-enabled");
      this.onNotice?.({ kind: "bt-on" });
      if (this.core.wantConnected) void this.startConnect();
    } else {
      this.core.suspend(); // stop futile backoff; bt-on resumes instead
      connectionLog.log(this.id, "bt-disabled");
      this.onNotice?.({ kind: "bt-off" });
    }
  }

  /**
   * A connect failure may really be "Bluetooth just turned off" (racing the
   * enabled notification). Detect it so the failure surfaces as the bt-off
   * banner + resume-on-enable instead of a futile backoff loop.
   */
  private async detectBtOff(): Promise<boolean> {
    const enabled = await BleClient.isEnabled().catch(() => true);
    if (enabled) return false;
    if (!this.core.isSuspended()) {
      this.core.suspend();
      connectionLog.log(this.id, "bt-disabled", "detected on failure");
      this.onNotice?.({ kind: "bt-off" });
    }
    return true;
  }

  // First connect: native scan picker (needs the user gesture from selecting
  // this provider). A cancelled/failed picker drops the intent — re-opening it
  // would need a fresh gesture, so we don't auto-retry the picker.
  private async pickAndConnect(): Promise<void> {
    // The picker needs a user gesture; a cancel/failure here can't be retried
    // silently, so drop the intent — but loudly (log + notice).
    try {
      await BleClient.initialize();
      await this.releaseStaleLinks();
      connectionLog.log(this.id, "picker-shown");
      this.device = await BleClient.requestDevice({ services: [NUS_SERVICE] });
      saveBleDevice({
        deviceId: this.device.deviceId,
        name: this.device.name,
      });
      connectionLog.log(
        this.id,
        "device-selected",
        `${this.device.name ?? "?"} ${this.device.deviceId}`,
      );
    } catch (err) {
      console.warn("Capacitor BLE GPS device not selected:", err);
      connectionLog.log(this.id, "picker-cancelled", String(err));
      if (!(await this.detectBtOff())) {
        this.onNotice?.({ kind: "picker-cancelled", detail: String(err) });
        this.core.dropIntent();
      }
      return;
    }
    // Opening the link can fail transiently (e.g. the peripheral's single
    // client slot is still held by a stale connection). Retry on a backoff
    // rather than giving up — no gesture needed.
    try {
      connectionLog.log(
        this.id,
        "connect-attempt",
        this.attemptDetail("initial"),
      );
      await this.core.runEstablish("initial");
    } catch (err) {
      console.warn("Capacitor BLE GPS connect failed, retrying:", err);
      connectionLog.log(this.id, "error", `connect: ${String(err)}`);
      await this.core.noteEstablishFailed(err);
    }
  }

  // Close any pod link the native layer still holds before scanning. A page
  // reload (About → "Clear Cache & Reload") tears down the JS context but not
  // the native BLE plugin, so its BluetoothGatt survives — keeping the pod's
  // single client slot, so the pod stops advertising and the fresh scan finds
  // nothing. Disconnecting the leaked link frees the pod to advertise again.
  private async releaseStaleLinks(): Promise<void> {
    try {
      const stale = await BleClient.getConnectedDevices([NUS_SERVICE]);
      for (const d of stale) {
        await BleClient.disconnect(d.deviceId).catch(() => {});
      }
    } catch (err) {
      console.warn("Capacitor BLE GPS: stale-link sweep failed:", err);
    }
  }

  // Connect + subscribe on the already-chosen deviceId. Used for both the
  // initial connect and every reconnect (no gesture needed).
  private async openLink(): Promise<void> {
    const id = this.device?.deviceId;
    if (!id) throw new Error("no device");
    this.linkDeviceId = id;
    // Clear any half-open link first: a pod reboot can leave the stack
    // believing it's still connected, so connect()/startNotifications()
    // resolve on a dead handle. A clean disconnect releases the pod's single
    // client slot — what toggling the GPS source to None does manually.
    await BleClient.disconnect(id).catch(() => {});
    await BleClient.connect(id, () => this.onPeripheralDisconnect());
    await BleClient.startNotifications(id, NUS_SERVICE, NUS_TX, (value) => {
      this.core.noteData();
      this.stream.push(this.decoder.decode(value));
    });
  }

  private handleEstablished(): void {
    this.stream.reset();
    connectionLog.log(this.id, "connected", this.device?.name ?? undefined);
    this.onNotice?.({ kind: "connected" });
    // Re-arm satellite forwarding if a diagnostics view is open across a reconnect.
    if (this.satWanted) this.sendSatCommand(true);
  }

  // Release the link the establish just opened (the intent was dropped while
  // it was awaited — leaking it would hold the pod's single client slot).
  private teardownLink(): void {
    const id = this.linkDeviceId;
    if (!id) return;
    BleClient.stopNotifications(id, NUS_SERVICE, NUS_TX).catch(() => {});
    BleClient.disconnect(id).catch(() => {});
  }

  private onPeripheralDisconnect(): void {
    this.core.noteLinkDropped();
  }
}
