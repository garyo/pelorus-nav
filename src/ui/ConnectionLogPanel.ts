/**
 * Viewer for the persistent connection event log (ConnectionEventLog) —
 * the field-diagnosis record of BLE connects, drops, Bluetooth state changes
 * and reconnect attempts. Static snapshot per open (no live polling); Share
 * exports CSV through the platform share sheet / file save.
 */

import { downloadFile } from "../data/file-io";
import { connectionLog } from "../navigation/ConnectionEventLog";

export class ConnectionLogPanel {
  private readonly overlay: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private visible = false;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "about-overlay";

    const card = document.createElement("div");
    card.className = "about-card conn-log-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "Connection event log";

    this.text = document.createElement("pre");
    this.text.className = "conn-log-text";

    const buttons = document.createElement("div");
    buttons.className = "conn-log-buttons";

    const shareBtn = document.createElement("button");
    shareBtn.className = "settings-action-btn";
    shareBtn.textContent = "Share";
    shareBtn.addEventListener("click", () => {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      void downloadFile(
        connectionLog.toCSV(),
        `connection-log-${ts}.csv`,
        "text/csv",
      );
    });

    const clearBtn = document.createElement("button");
    clearBtn.className = "settings-action-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      connectionLog.clear();
      this.refresh();
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "settings-action-btn";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.hide());

    buttons.append(shareBtn, clearBtn, closeBtn);
    card.append(title, this.text, buttons);
    this.overlay.appendChild(card);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.visible) {
        e.preventDefault(); // consumed — the global Escape fallback must not also act
        this.hide();
      }
    });
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.refresh();
    this.overlay.style.display = "flex";
    this.text.scrollTop = this.text.scrollHeight; // newest entries at the bottom
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.display = "none";
  }

  private refresh(): void {
    this.text.textContent =
      connectionLog.entryCount > 0 ? connectionLog.toText() : "(no events)";
  }
}
