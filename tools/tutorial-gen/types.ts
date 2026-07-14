import type { Page } from "@playwright/test";

/**
 * Generic, app-neutral types for the tutorial-video engine. A tutorial author
 * writes a `Storyboard` (scenes + theme + intro/outro); a new app needs an
 * `AppAdapter` that holds all app-specific knowledge (seeding, URLs, readiness,
 * and the typed app-op surface exposed to scenes as `ctx.app`). Nothing here
 * knows about any particular application.
 */

/** A screen-space point (device-independent CSS pixels). */
export interface XY {
  x: number;
  y: number;
}

/** Slow Ken-Burns push-in on a scene: end zoom factor + normalized center. */
export interface Punch {
  kind: "punch";
  zoom: number;
  cx: number;
  cy: number;
}

/**
 * Picture-in-picture magnifier: crop a square region of the base frame (coords
 * in delivery-resolution space), enlarge it, and float it as a labelled card.
 */
export interface Pip {
  kind: "pip";
  cropX: number;
  cropY: number;
  crop: number;
  scale: number;
  label: string;
}

export type Effect = Punch | Pip;

/** A still-image bookend (title / outro), faded from or to black. */
export interface Card {
  image: string;
  sec: number;
}

/** Caption + card styling shared across the storyboard. */
export interface Theme {
  /** Path to a TTF used for captions and PiP labels. */
  font: string;
  /** Accent colour (bar + PiP border). */
  accent?: string;
  /** Caption pill fill (any ImageMagick colour). */
  panel?: string;
  /** Caption point size. */
  captionPointSize?: number;
  /** Caption text left margin (delivery px). */
  captionTextX?: number;
  /** Accent bar left edge (delivery px). */
  captionBarX?: number;
  /** Caption text-box top (delivery px). */
  captionTop?: number;
}

/**
 * The interactions performed while a scene records, driven through a generic,
 * app-neutral surface. `app` is the adapter-provided typed op surface (e.g. a
 * map's flyTo/project) — the only place app-specific verbs live.
 */
export interface Driver<App = unknown> {
  /** The live Playwright page (for arbitrary app-specific interactions). */
  readonly page: Page;
  /** The adapter-provided app-op surface. */
  readonly app: App;
  /** Sleep, in ms. */
  wait(ms: number): Promise<void>;
  /** Navigate to a URL (domcontentloaded). */
  goto(url: string): Promise<void>;
  /** Reload the current page (domcontentloaded). */
  reload(): Promise<void>;
  /** Glide the visible cursor to a selector or point and click it. */
  click(target: string | XY): Promise<void>;
  /** Glide to a selector or point, press and hold for `holdMs`, release. */
  hold(target: string | XY, holdMs: number): Promise<void>;
  /** Drag a slider-like element between two fractions of its own width. */
  drag(
    selector: string,
    fromFrac: number,
    toFrac: number,
    ms?: number,
  ): Promise<void>;
  /** Reset the tracked cursor position (after a reload re-centers the overlay). */
  resetCursor(): void;
}

/** One captured segment of the tutorial. */
export interface Scene<Setup = unknown, App = unknown> {
  id: string;
  /** Lower-third caption text; omit for a silent scene. */
  caption?: string;
  /** Source in-point (seconds) of the usable window (skips boot/preroll). */
  in: number;
  /** Seconds of usable footage; the assemble trims to [in, in+duration]. */
  duration: number;
  /** App-specific per-scene configuration, consumed only by the adapter. */
  setup?: Setup;
  /** Interactions performed while recording. */
  drive(ctx: Driver<App>): Promise<void>;
  /** Optional post-processing effects applied during assemble. */
  effects?: Effect[];
}

/** The complete authored tutorial. */
export interface Storyboard<Setup = unknown, App = unknown> {
  scenes: Scene<Setup, App>[];
  theme: Theme;
  intro?: Card;
  outro?: Card;
  /** Cross-dissolve between segments (default 0.5s). */
  transition?: { kind: "dissolve"; sec: number };
}

/**
 * The app-specific seam. Everything a new application needs to plug into the
 * generic engine lives behind this interface: page seeding, URL construction,
 * a readiness predicate, and the typed op surface handed to scenes.
 */
export interface AppAdapter<Setup, App> {
  /** Base URL of the running app under capture. */
  readonly baseUrl: string;
  /** Register route intercepts + seed init scripts before navigation. */
  prepare(page: Page, scene: Scene<Setup, App>): Promise<void>;
  /** Full URL to open for a scene (may encode app-specific params). */
  urlFor(scene: Scene<Setup, App>): string;
  /** Resolve once the app is interactive (e.g. its main object exists). */
  ready(page: Page): Promise<void>;
  /** Optional post-ready, pre-drive setup (e.g. an initial camera zoom). */
  afterReady?(page: Page, scene: Scene<Setup, App>): Promise<void>;
  /** Build the typed app-op surface exposed to scenes as `ctx.app`. */
  makeApp(page: Page): App;
}
