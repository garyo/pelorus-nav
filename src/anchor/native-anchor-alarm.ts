/**
 * The anchor watch's two alarms, and where their *sound* comes from.
 *
 * On web that is Web Audio ({@link CobAlarm}), the only sound available
 * there. On native it is the foreground service: Android routes Web Audio to
 * the MEDIA stream — the one people turn down so videos don't blare, measured
 * at 2 of 15 on a test device against 11 of 15 on the ALARM stream — and a
 * resumed WebView leaves its AudioContext suspended until the next user
 * gesture. Neither is a foundation for a safety alarm, so the service plays
 * the device's alarm ringtone with USAGE_ALARM whenever either detector — its
 * own or the JS one — wants noise, in any app state.
 *
 * The native channels stand in for CobAlarm in {@link AnchorWatchManager}'s
 * deps, so the state machine, the banner and acknowledge/disarm are identical
 * on both platforms: only start/stop/setMuted change meaning, from "make a
 * noise" to "ask the service for one". Both alarms can be up at once, so the
 * channels are reference-counted against the one ringtone. Requests are
 * pushed on every call rather than deduplicated: the alarm notification's
 * Silence action can stop the sound behind this side's back, and an
 * unconditional push means the next state change re-establishes the truth.
 *
 * The one native case that still needs Web Audio is a service that isn't
 * there to answer — arming without location permission cannot start a
 * foreground service, and an old shell may not know the method at all. Then
 * the channels fall back to sounding for themselves, media stream and all: a
 * quiet alarm beats no alarm.
 */

import { Capacitor } from "@capacitor/core";
import { CobAlarm } from "../cob/CobAlarm";
import { BackgroundGPS } from "../plugins/BackgroundGPS";

/** The slice of the native plugin the alarm sound needs. */
export interface NativeAnchorAlarmPlugin {
  setAnchorAlarmSound(options: {
    sounding: boolean;
    muted: boolean;
  }): Promise<{ serviceRunning: boolean }>;
}

/**
 * One alarm's worth of the {@link CobAlarm} surface the anchor watch uses:
 * the manager drives start/stop/setMuted, the panel the blocked-audio trio.
 * CobAlarm satisfies it structurally.
 */
export interface AnchorAlarmSound {
  start(muted: boolean): void;
  stop(): void;
  setMuted(muted: boolean): void;
  isBlocked(): boolean;
  onBlockedChange(cb: (blocked: boolean) => void): void;
  retryUnlock(): void;
}

export interface AnchorAlarmOptions {
  plugin?: NativeAnchorAlarmPlugin;
  /** Defaults to Capacitor's platform check; tests pass it explicitly. */
  isNative?: boolean;
}

/**
 * The drag alarm and the GPS-loss alarm. Separate instances so lost GPS never
 * sounds like a drag — on web the GPS-loss cadence is a slower single tone;
 * native plays one ringtone for either and distinguishes them in its
 * notification.
 */
export function createAnchorAlarms(options: AnchorAlarmOptions = {}): {
  drag: AnchorAlarmSound;
  gpsLoss: AnchorAlarmSound;
} {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  if (!isNative) {
    return {
      drag: new CobAlarm(),
      gpsLoss: new CobAlarm({ toneHz: [520, 520], beatIntervalMs: 2000 }),
    };
  }
  const sound = new NativeAnchorAlarmSound(options.plugin);
  return { drag: sound.channel("drag"), gpsLoss: sound.channel("gps-loss") };
}

/** The service-owned alarm sound, shared by the watch's alarm channels. */
export class NativeAnchorAlarmSound {
  private readonly plugin: NativeAnchorAlarmPlugin;
  /** Channel ids currently asking for noise. */
  private readonly sounding = new Set<string>();
  private muted = false;
  /**
   * Web Audio, for the one native case where the service cannot answer: it
   * isn't running (arming without location permission cannot start a
   * foreground service) or the shell predates the method. Screen-off cover is
   * already gone in that state and the panel says so — but the JS watch is
   * still watching, and a quiet alarm beats no alarm.
   */
  private readonly fallback = new CobAlarm();

  constructor(plugin?: NativeAnchorAlarmPlugin) {
    this.plugin = plugin ?? (BackgroundGPS as NativeAnchorAlarmPlugin);
  }

  /**
   * True while the Web Audio fallback is carrying the alarm, i.e. no service
   * answered. Nothing native is sounding, and screen-off cover is gone too.
   */
  soundingLocally(): boolean {
    return this.fallback.isRunning();
  }

  /** An alarm channel for the manager, e.g. "drag" or "gps-loss". */
  channel(id: string): AnchorAlarmSound {
    return {
      start: (muted: boolean) => {
        this.muted = muted;
        this.sounding.add(id);
        this.push();
      },
      stop: () => {
        this.sounding.delete(id);
        this.push();
      },
      setMuted: (muted: boolean) => {
        this.muted = muted;
        this.push();
      },
      // The fallback is the only thing here that can be blocked, and it only
      // runs when the service can't sound — report it so the panel's "tap to
      // enable sound" line appears exactly then.
      isBlocked: () => this.fallback.isRunning() && this.fallback.isBlocked(),
      onBlockedChange: (cb) => this.fallback.onBlockedChange(cb),
      retryUnlock: () => this.fallback.retryUnlock(),
    };
  }

  private push(): void {
    const sounding = this.sounding.size > 0;
    const muted = this.muted;
    this.plugin.setAnchorAlarmSound({ sounding, muted }).then(
      (result) =>
        this.applyFallback(sounding && !result?.serviceRunning, muted),
      (err) => {
        // A native shell without the method must never take the watch down
        // with it: the alarm state, its banner and disarm all still work.
        console.warn("native anchor alarm sound", err);
        this.applyFallback(sounding, muted);
      },
    );
  }

  /** Sound for ourselves after all, or stop doing so. */
  private applyFallback(active: boolean, muted: boolean): void {
    if (active) this.fallback.start(muted);
    else this.fallback.stop();
    this.fallback.setMuted(muted);
  }
}
