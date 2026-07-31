/**
 * Capture files the OS hands us through "open with", so none are lost to
 * startup ordering.
 *
 * A cold start via a file association delivers the event before the disclaimer
 * gate clears and long before the map layers exist, so capture and consumption
 * are split: installFileOpenCapture() runs at the very top of main.ts and does
 * no awaiting, while onFileOpen() registers the consumer once the app is built
 * and drains whatever queued up.
 *
 * The file's bytes are read at capture time, not at drain time. An Android
 * ACTION_VIEW content-URI grant is scoped to the receiving activity and can't
 * be persisted, so waiting until the user has accepted the disclaimer risks
 * reading a URI whose permission is already gone.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { filenameFromUrl, readFileUrl } from "../data/file-io";

export interface OpenedFile {
  /** The URL as the platform delivered it (content:// or file://). */
  url: string;
  /** Basename for messages; null when the URL carries no filename. */
  name: string | null;
  /** The file's text. Already in flight — await it, and handle rejection. */
  text: Promise<string>;
}

type FileOpenHandler = (file: OpenedFile) => Promise<void> | void;

/** Beyond this, a pathological burst would just retain file text forever. */
const MAX_PENDING = 8;

const pending: OpenedFile[] = [];
let handler: FileOpenHandler | null = null;
let installed = false;

/** URLs that are navigation or deep links, not files to import. */
function isFileUrl(url: string): boolean {
  const scheme = url.slice(0, url.indexOf(":")).toLowerCase();
  return (
    scheme !== "http" && scheme !== "https" && scheme !== "nav.pelorus.app"
  );
}

function deliver(file: OpenedFile): void {
  if (!handler) {
    // Collapse repeats *within the queue* only: the same file arriving twice
    // before we can consume it is one open, but a genuine re-open later must
    // still import.
    if (pending.some((p) => p.url === file.url)) return;
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(file);
    return;
  }
  void handler(file);
}

function capture(url: string): void {
  if (!isFileUrl(url)) return;
  const text = readFileUrl(url);
  // The read may reject long before anything awaits it; keep that from
  // surfacing as an unhandled rejection without swallowing the error, which
  // the consumer still sees when it awaits.
  text.catch(() => {});
  deliver({ url, name: filenameFromUrl(url), text });
}

/**
 * Start listening for "open with" events. Call once, before anything in
 * startup that can block. Does nothing on the web, which has no such events.
 */
export function installFileOpenCapture(): void {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;
  // Both platforms retain this event until a listener consumes it, so
  // registering here (rather than after the disclaimer) loses nothing and
  // guarantees the read happens while the URI grant is fresh.
  void App.addListener("appUrlOpen", (event) => {
    capture(event.url);
  });
}

/**
 * Register the consumer. Anything captured before this point is delivered
 * immediately, in arrival order; later opens go straight through.
 */
export function onFileOpen(fn: FileOpenHandler): void {
  handler = fn;
  const queued = pending.splice(0, pending.length);
  for (const file of queued) void fn(file);
}

/** Test seam: forget listeners and queued files. */
export function resetFileOpenQueue(): void {
  pending.length = 0;
  handler = null;
  installed = false;
}
