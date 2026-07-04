/**
 * Browser file download and upload utilities.
 */

import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export const GPX_MIME = "application/gpx+xml";

/**
 * `accept` filter for GPX file pickers. `.gpx` has no system-registered UTI on
 * iOS, so a bare ".gpx" makes WebKit's Files picker grey out iCloud Drive and
 * cloud-provider items it can't type-resolve. Listing resolvable MIME types
 * alongside keeps those sources selectable; the GPX parser rejects non-GPX
 * input, so a stray .xml pick still fails cleanly.
 */
export const GPX_ACCEPT = ".gpx,application/gpx+xml,application/xml,text/xml";

export type ShareOutcome = "shared" | "downloaded" | "cancelled";

/**
 * Share (native) or download (web) a text file. Resolves "cancelled" when the
 * user dismisses the native share sheet; rejects on real failures (e.g. the
 * temp-file write) so callers can surface them — unlike downloadFile, which
 * fires and forgets.
 */
export async function shareOrDownloadFile(
  content: string,
  filename: string,
  mimeType: string,
): Promise<ShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    // The WebView doesn't support <a download>. Write a temp file and share
    // it so the receiving app gets a real file with the correct name.
    const result = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({
        title: filename,
        url: result.uri,
        dialogTitle: `Save ${filename}`,
      });
      return "shared";
    } catch (e) {
      // Both platforms reject with "Share canceled" on user dismissal —
      // a clean outcome, not an error.
      if (/cancel/i.test(String(e))) return "cancelled";
      throw e;
    }
  }

  // Standard browser download via <a download>
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return "downloaded";
}

/** Fire-and-forget wrapper around shareOrDownloadFile for legacy callers. */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  void shareOrDownloadFile(content, filename, mimeType).catch((e) => {
    console.warn("downloadFile failed:", String(e));
  });
}

/** Open a file picker and return the selected file's text content. */
export function pickFile(accept: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });

    // Boolean const rather than an inline `in` test: TS's lib.dom declares
    // oncancel on all inputs, so a direct narrowing check makes the legacy
    // branch `never` — but old engines really lack the event.
    const supportsCancel: boolean = "oncancel" in input;
    if (supportsCancel) {
      // Modern engines (iOS WebKit 16.4+, Chrome 113+) fire a real cancel
      // event on picker dismissal — the reliable path.
      input.addEventListener("cancel", () => {
        input.remove();
        reject(new Error("File selection cancelled"));
      });
    } else {
      // Legacy fallback: infer cancellation from focus returning with no
      // change event. The grace must be generous — iOS delivers `change`
      // seconds after focus (the Files sheet copies from the provider first),
      // and tearing the input down early silently swallows the pick.
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        setTimeout(() => {
          if (input.parentNode) {
            input.remove();
            reject(new Error("File selection cancelled"));
          }
        }, 5000);
      };
      window.addEventListener("focus", onFocus);
    }

    input.click();
  });
}

/** Replace characters that are invalid in filenames with underscores. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim() || "export";
}
