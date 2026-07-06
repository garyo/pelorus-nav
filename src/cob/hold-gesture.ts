/**
 * Hold-to-confirm gesture for guarded emergency actions (COB activate,
 * "recovered" resolve). One deliberate press-and-hold with visible progress
 * beats a confirm dialog on a wet, bouncing touchscreen: a brush or panicked
 * double-tap can't trigger it, and releasing early always cancels.
 */

export interface HoldTimer {
  /** Fraction complete in [0,1] at time `now`. */
  progress(now: number): number;
  /** True once the hold duration has elapsed at time `now`. */
  isComplete(now: number): boolean;
}

/** Pure timing core, extracted so tests need no DOM or real clock. */
export function createHoldTimer(holdMs: number, startedAt: number): HoldTimer {
  return {
    progress(now) {
      if (holdMs <= 0) return 1;
      return Math.min(1, Math.max(0, (now - startedAt) / holdMs));
    },
    isComplete(now) {
      return now - startedAt >= holdMs;
    },
  };
}

/** Quantize progress to `steps` discrete jumps (e-ink: no smooth animation). */
export function stepProgress(frac: number, steps: number): number {
  return Math.floor(frac * steps) / steps;
}

export interface HoldGestureOptions {
  holdMs: number;
  /** Called with progress in [0,1] while held; final call is exactly 1. */
  onProgress(frac: number): void;
  /** The hold completed — fire the guarded action. */
  onComplete(): void;
  /** Released or interrupted before completion. */
  onCancel(): void;
  /** Quantize progress into 4 jumps and poll at 100 ms (e-ink displays). */
  stepped?: () => boolean;
}

const STEPPED_STEPS = 4;
const STEPPED_INTERVAL_MS = 100;

/**
 * Attach a press-and-hold gesture to an element. Returns a detach function.
 * Pointer (mouse/touch/pen) and keyboard (Space/Enter) both work.
 */
export function attachHoldGesture(
  el: HTMLElement,
  opts: HoldGestureOptions,
): () => void {
  let timer: HoldTimer | null = null;
  let raf = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let completion: ReturnType<typeof setTimeout> | null = null;
  let lastReported = -1;

  const stopTicking = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (interval) clearInterval(interval);
    interval = null;
    if (completion) clearTimeout(completion);
    completion = null;
  };

  const finish = (completed: boolean): void => {
    if (!timer) return;
    timer = null;
    stopTicking();
    lastReported = -1;
    if (completed) {
      opts.onProgress(1);
      opts.onComplete();
    } else {
      opts.onCancel();
    }
  };

  const tick = (): void => {
    if (!timer) return;
    const now = performance.now();
    if (timer.isComplete(now)) {
      finish(true);
      return;
    }
    const raw = timer.progress(now);
    const frac = opts.stepped?.() ? stepProgress(raw, STEPPED_STEPS) : raw;
    if (frac !== lastReported) {
      lastReported = frac;
      opts.onProgress(frac);
    }
    if (!interval) raf = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (timer) return;
    timer = createHoldTimer(opts.holdMs, performance.now());
    opts.onProgress(0);
    // Completion is timer-driven, not frame-driven: rAF can stall entirely
    // when nothing invalidates frames (headless, throttled/e-ink displays),
    // and an emergency action must fire on time regardless of rendering.
    completion = setTimeout(() => finish(true), opts.holdMs);
    if (opts.stepped?.()) {
      interval = setInterval(tick, STEPPED_INTERVAL_MS);
    } else {
      raf = requestAnimationFrame(tick);
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.isPrimary === false) return; // ignore secondary touches only
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture unavailable (some test/embedded environments)
    }
    start();
  };

  // A deliberate release completes if the wall-clock hold was long enough,
  // even when the completion timeout is late (main-thread jank can delay it
  // past the release on slow devices). Interruptions always cancel.
  const onRelease = (): void => {
    if (!timer) return;
    finish(timer.isComplete(performance.now()));
  };
  const onAbort = (): void => finish(false);

  // Keyboard accessibility: hold Space/Enter.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      start();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === " " || e.key === "Enter") onRelease();
  };

  // A 1.5 s touch-hold is also a native long-press — suppress the context menu.
  const onContextMenu = (e: Event): void => e.preventDefault();

  el.style.touchAction = "none";
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointerup", onRelease);
  el.addEventListener("pointercancel", onAbort);
  el.addEventListener("lostpointercapture", onAbort);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("keyup", onKeyUp);
  el.addEventListener("blur", onAbort);
  el.addEventListener("contextmenu", onContextMenu);

  return () => {
    finish(false);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointerup", onRelease);
    el.removeEventListener("pointercancel", onAbort);
    el.removeEventListener("lostpointercapture", onAbort);
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("keyup", onKeyUp);
    el.removeEventListener("blur", onAbort);
    el.removeEventListener("contextmenu", onContextMenu);
  };
}
