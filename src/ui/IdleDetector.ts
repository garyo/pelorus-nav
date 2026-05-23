/**
 * Fires when the user hasn't touched/clicked anything for `timeoutMs`,
 * and again (with `false`) on the next interaction. Used to back off
 * GPS polling — at anchor or on autopilot we don't need 1 Hz fixes.
 */

export type IdleListener = (idle: boolean) => void;

export interface IdleDetector {
  isIdle(): boolean;
  onChange(fn: IdleListener): () => void;
  dispose(): void;
}

export function createIdleDetector(timeoutMs: number): IdleDetector {
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners: IdleListener[] = [];

  const notify = () => {
    for (const fn of listeners) fn(idle);
  };

  const becomeIdle = () => {
    if (idle) return;
    idle = true;
    notify();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(becomeIdle, timeoutMs);
  };

  const onInteract = () => {
    const wasIdle = idle;
    if (wasIdle) {
      idle = false;
      notify();
    }
    schedule();
  };

  // Capture phase so the listener fires before app handlers consume the event,
  // and works even when the gesture starts over panels with stopPropagation.
  const events = ["pointerdown", "touchstart", "keydown", "wheel"] as const;
  for (const e of events) {
    document.addEventListener(e, onInteract, {
      capture: true,
      passive: true,
    });
  }
  schedule();

  return {
    isIdle: () => idle,
    onChange(fn: IdleListener): () => void {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const e of events) {
        document.removeEventListener(e, onInteract, { capture: true });
      }
      listeners.length = 0;
    },
  };
}
