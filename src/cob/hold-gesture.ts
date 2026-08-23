/**
 * Hold-to-confirm gesture for guarded emergency actions (COB activate,
 * "recovered" resolve). One deliberate press-and-hold with visible progress
 * beats a confirm dialog on a wet, bouncing touchscreen: a brush or panicked
 * double-tap can't trigger it, and releasing early always cancels.
 */

import { startPaintTrace, stopPaintTrace } from "../diagnostics/paint-trace";
import { diag } from "../utils/diag";

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
  /** Quantize progress into jumps and poll at 100 ms (e-ink displays). */
  stepped?: () => boolean;
  /**
   * How many jumps `stepped` quantizes into. Defaults to 4. Callers that
   * draw one mark per step pass their mark count, so every step the gesture
   * reports is a step the user can see.
   */
  steppedSteps?: () => number;
  /**
   * The press began. Callers use this to hold off anything that would
   * remove or hide the element being held: losing it mid-gesture drops
   * pointer capture and cancels the hold.
   */
  onStart?(): void;
}

const STEPPED_STEPS = 4;

/**
 * How long a touch may vanish before the hold is treated as released.
 *
 * E-ink digitizers drop the contact during a panel refresh, reporting a
 * pointerup the finger never made — and repaints the hold cannot freeze
 * (HUD connection churn, map layers) keep landing during an alarm, so the
 * hold must survive them. A full e-ink refresh blanks the digitizer for
 * 400-600 ms; the field failure at 250 ms was the returning touch arriving
 * after the hold had already cancelled, on every attempt. Within this
 * window the hold pauses rather than cancels — the completion timer is
 * stopped, so an abandoned hold can never fire — and a returning press
 * resumes where it left off; a genuine release costs only this much
 * latency before it cancels.
 */
export const RELEASE_GRACE_MS = 800;
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
  /** Set while a release is being given the benefit of the doubt. */
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** performance.now() when the hold began, shifted by any paused time. */
  let startedAt = 0;
  /** performance.now() when the current pause began. */
  let pausedAt = 0;
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

  const finish = (completed: boolean, why = "release"): void => {
    if (!timer) return;
    const heldMs = Math.round(performance.now() - startedAt);
    timer = null;
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    stopPaintTrace(completed ? "done" : why);
    // Aborted guarded holds are field-diagnosable or they repeat forever:
    // one diag line names what ended the gesture (a system pointercancel, a
    // capture loss, a release that outlived the grace) and how far in.
    if (!completed && heldMs > 300) {
      diag("hold", `aborted ${why} at ${heldMs}ms of ${opts.holdMs}ms`);
    }
    stopTicking();
    removeWindowFallback();
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
    const frac = opts.stepped?.()
      ? stepProgress(raw, opts.steppedSteps?.() ?? STEPPED_STEPS)
      : raw;
    if (frac !== lastReported) {
      lastReported = frac;
      opts.onProgress(frac);
    }
    if (!interval) raf = requestAnimationFrame(tick);
  };

  const startTicking = (): void => {
    if (opts.stepped?.()) {
      interval = setInterval(tick, STEPPED_INTERVAL_MS);
    } else {
      raf = requestAnimationFrame(tick);
    }
  };

  /** The touch came back inside the grace window — carry on where we were. */
  const resume = (): void => {
    if (graceTimer === null) return;
    clearTimeout(graceTimer);
    graceTimer = null;
    startedAt += performance.now() - pausedAt;
    timer = createHoldTimer(opts.holdMs, startedAt);
    completion = setTimeout(
      () => finish(true),
      Math.max(0, startedAt + opts.holdMs - performance.now()),
    );
    startTicking();
  };

  const start = (): void => {
    if (timer) return;
    startPaintTrace(`hold ${opts.holdMs}ms`);
    opts.onStart?.();
    startedAt = performance.now();
    timer = createHoldTimer(opts.holdMs, startedAt);
    opts.onProgress(0);
    // Completion is timer-driven, not frame-driven: rAF can stall entirely
    // when nothing invalidates frames (headless, throttled/e-ink displays),
    // and an emergency action must fire on time regardless of rendering.
    completion = setTimeout(() => finish(true), opts.holdMs);
    startTicking();
  };

  // Fallback when pointer capture is unavailable: without capture, a release
  // off the element never reaches el's pointerup listener, so the completion
  // timeout would fire and complete the guarded action despite the abandoned
  // hold. Window-level listeners see the release wherever it lands.
  let windowFallback = false;
  const addWindowFallback = (): void => {
    if (windowFallback) return;
    windowFallback = true;
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onAbort);
  };
  const removeWindowFallback = (): void => {
    if (!windowFallback) return;
    windowFallback = false;
    window.removeEventListener("pointerup", onRelease);
    window.removeEventListener("pointercancel", onAbort);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.isPrimary === false) return; // ignore secondary touches only
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      addWindowFallback();
    }
    if (graceTimer !== null) {
      resume();
      return;
    }
    start();
  };

  // A deliberate release completes if the wall-clock hold was long enough,
  // even when the completion timeout is late (main-thread jank can delay it
  // past the release on slow devices). Interruptions always cancel.
  const onRelease = (): void => {
    if (!timer || graceTimer !== null) return;
    const now = performance.now();
    if (timer.isComplete(now)) {
      finish(true);
      return;
    }
    // Pause rather than cancel: see RELEASE_GRACE_MS. The completion timeout
    // stops too, so an abandoned hold can never fire the guarded action.
    pausedAt = now;
    if (completion) {
      clearTimeout(completion);
      completion = null;
    }
    stopTicking();
    graceTimer = setTimeout(() => {
      graceTimer = null;
      finish(false, "release");
    }, RELEASE_GRACE_MS);
  };
  const onAbort = (e?: Event): void => finish(false, e?.type ?? "abort");

  // A captured pointer's release is always followed by lostpointercapture,
  // so treating it as an abort would kill the grace pause the pointerup just
  // started — the exact e-ink phantom-drop the grace exists for. Route it
  // through the release path instead: after a pointerup it's a no-op (the
  // grace is already running), and a bare capture loss gets the same grace.
  // A real interruption still hard-aborts via pointercancel, which fires
  // before its own lostpointercapture and leaves nothing for it to end.
  const onLostCapture = (): void => onRelease();

  // Keyboard accessibility: hold Space/Enter.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      start();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    // No grace for a key release: RELEASE_GRACE_MS exists for touchscreens
    // that drop a contact during a refresh, and a keyup is never that.
    if (e.key !== " " && e.key !== "Enter") return;
    if (!timer) return;
    finish(timer.isComplete(performance.now()), "keyup");
  };

  // A 1.5 s touch-hold is also a native long-press — suppress the context menu.
  const onContextMenu = (e: Event): void => e.preventDefault();

  el.style.touchAction = "none";
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointerup", onRelease);
  el.addEventListener("pointercancel", onAbort);
  el.addEventListener("lostpointercapture", onLostCapture);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("keyup", onKeyUp);
  el.addEventListener("blur", onAbort);
  el.addEventListener("contextmenu", onContextMenu);

  return () => {
    finish(false);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointerup", onRelease);
    el.removeEventListener("pointercancel", onAbort);
    el.removeEventListener("lostpointercapture", onLostCapture);
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("keyup", onKeyUp);
    el.removeEventListener("blur", onAbort);
    el.removeEventListener("contextmenu", onContextMenu);
  };
}
