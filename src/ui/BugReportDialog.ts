/**
 * "Report a Bug" dialog (opened from the About dialog): a short description
 * from the user plus the full diagnostics dump, POSTed to /api/bug-report so
 * reports arrive server-side with everything needed to debug — no follow-up
 * "can you send me your settings?" round-trips. If the upload fails (offline,
 * offshore), falls back to sharing the same report as a file.
 */

import { shareOrDownloadFile } from "../data/file-io";
import { chartAssetBase } from "../data/remote-url";
import { diagnosticsFilename } from "../diagnostics/collectDiagnostics";
import { logUiAction } from "../diagnostics/uiActionLog";

const UPLOAD_TIMEOUT_MS = 20_000;

export interface BugReportOptions {
  /** Produces the diagnostics text to attach (may take a few seconds). */
  collectDiagnostics: () => Promise<string>;
  /**
   * Captures the chart as a JPEG data URL (null if capture fails). Taken when
   * the dialog opens; attached only if the user leaves the checkbox on — a
   * chart screenshot reveals the vessel's position, so it's their call.
   */
  captureScreenshot?: () => Promise<string | null>;
}

export function showBugReportDialog(options: BugReportOptions): void {
  logUiAction("open bug-report");
  const overlay = document.createElement("div");
  overlay.className = "about-overlay bugreport-overlay";
  overlay.style.display = "flex";

  const card = document.createElement("div");
  card.className = "about-card bugreport-card";
  overlay.appendChild(card);

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault(); // consumed — the global Escape fallback must not also act
      close();
    }
  };
  const close = (): void => {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  };
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);

  const title = document.createElement("div");
  title.className = "about-title";
  title.textContent = "Report a Bug";

  const description = document.createElement("textarea");
  description.className = "bugreport-description";
  description.placeholder = "What went wrong? What did you expect to happen?";
  description.maxLength = 2000;
  description.rows = 5;

  const email = document.createElement("input");
  email.className = "bugreport-email";
  email.type = "email";
  email.placeholder = "Email (optional — if you'd like a reply)";
  email.maxLength = 254;

  const note = document.createElement("div");
  note.className = "bugreport-note";
  note.textContent =
    "App diagnostics are included automatically: device info, settings, " +
    "recent logs, and GPS data.";

  // Chart screenshot: captured when the dialog opens (the overlay is DOM, so
  // it never appears in the WebGL capture); the row stays hidden until the
  // capture resolves so a failed capture just means no checkbox.
  const screenshotRow = document.createElement("label");
  screenshotRow.className = "bugreport-screenshot";
  screenshotRow.style.display = "none";
  const screenshotCheck = document.createElement("input");
  screenshotCheck.type = "checkbox";
  screenshotCheck.checked = true;
  const screenshotLabel = document.createElement("span");
  screenshotLabel.textContent = "Include chart screenshot";
  const screenshotThumb = document.createElement("img");
  screenshotThumb.className = "bugreport-screenshot-thumb";
  screenshotThumb.alt = "Chart screenshot preview";
  screenshotRow.append(screenshotCheck, screenshotLabel, screenshotThumb);

  let screenshot: string | null = null;
  options.captureScreenshot?.().then((dataUrl) => {
    if (!dataUrl || !overlay.isConnected) return;
    screenshot = dataUrl;
    screenshotThumb.src = dataUrl;
    screenshotRow.style.display = "";
  });

  const status = document.createElement("div");
  status.className = "bugreport-status";

  const buttons = document.createElement("div");
  buttons.className = "disclaimer-buttons";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "screen-timeout-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);
  const sendBtn = document.createElement("button");
  sendBtn.className = "screen-timeout-btn primary";
  sendBtn.textContent = "Send Report";
  buttons.append(cancelBtn, sendBtn);

  card.append(title, description, email, note, screenshotRow, status, buttons);
  document.body.appendChild(overlay);
  description.focus();

  // `onclick` (not addEventListener) so the offline fallback can swap the
  // button's action to "share as file" without stacking handlers.
  sendBtn.onclick = async () => {
    const text = description.value.trim();
    if (!text) {
      status.textContent = "Please describe what went wrong.";
      description.focus();
      return;
    }
    sendBtn.disabled = true;
    cancelBtn.disabled = true;
    status.textContent = "Collecting diagnostics…";
    const diagnostics = await options.collectDiagnostics();

    status.textContent = "Uploading…";
    try {
      const res = await fetch(`${chartAssetBase()}/api/bug-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: text,
          email: email.value.trim(),
          diagnostics,
          ...(screenshot && screenshotCheck.checked ? { screenshot } : {}),
        }),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status.textContent = "Thanks! Report sent.";
      sendBtn.textContent = "Sent ✓";
      setTimeout(close, 1500);
    } catch {
      // Offline (offshore) or server trouble — offer the report as a file so
      // it can still reach the developer by other means.
      status.textContent =
        "Couldn't upload the report (offline?). You can share it as a file instead.";
      sendBtn.textContent = "Share as File…";
      sendBtn.disabled = false;
      cancelBtn.disabled = false;
      sendBtn.onclick = async () => {
        const combined = `--- DESCRIPTION ---\n${text}\n\nEmail: ${email.value.trim() || "(none)"}\n\n--- DIAGNOSTICS ---\n${diagnostics}`;
        try {
          await shareOrDownloadFile(
            combined,
            diagnosticsFilename(),
            "text/plain",
          );
          close();
        } catch (e) {
          status.textContent = `Share failed: ${String(e).slice(0, 80)}`;
        }
      };
    }
  };
}
