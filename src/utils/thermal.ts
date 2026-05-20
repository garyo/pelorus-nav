/**
 * Thermal / CPU-pressure monitor backed by the W3C Compute Pressure API
 * (Chrome 125+, Edge 125+). Falls back to a static "nominal" state on
 * browsers that don't expose `PressureObserver`.
 *
 * The state correlates with thermal throttling: when the SoC heats up
 * the OS reduces clock frequency and reported pressure rises from
 * "nominal" → "fair" → "serious" → "critical". We use that signal to
 * voluntarily lower our own render rate and avoid sustaining the load.
 */

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

export interface ThermalMonitor {
  getState(): ThermalState;
  onChange(listener: (state: ThermalState) => void): () => void;
}

// PressureObserver isn't in TypeScript's default lib.dom typings yet —
// declare the minimal surface we need.
interface PressureRecord {
  source: "cpu" | "gpu" | "thermals";
  state: ThermalState;
  time: number;
}
interface PressureObserverConstructor {
  new (
    callback: (records: PressureRecord[]) => void,
  ): {
    observe(source: "cpu", opts?: { sampleInterval?: number }): Promise<void>;
    disconnect(): void;
  };
}

export function createThermalMonitor(): ThermalMonitor {
  let state: ThermalState = "nominal";
  const listeners: ((s: ThermalState) => void)[] = [];

  const Ctor = (
    globalThis as { PressureObserver?: PressureObserverConstructor }
  ).PressureObserver;
  if (Ctor) {
    try {
      const observer = new Ctor((records) => {
        const latest = records[records.length - 1];
        if (!latest || latest.source !== "cpu") return;
        if (latest.state === state) return;
        state = latest.state;
        for (const fn of listeners) fn(state);
      });
      observer.observe("cpu", { sampleInterval: 2000 }).catch(() => {
        // Permission denied or feature gated — stay at nominal.
      });
    } catch {
      // Constructor threw — stay at nominal.
    }
  }

  return {
    getState: () => state,
    onChange(listener) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}
