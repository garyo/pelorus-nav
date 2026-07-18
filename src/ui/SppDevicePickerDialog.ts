/**
 * Chooser for a paired Bluetooth Classic (SPP) GPS device. Classic devices
 * pair in Android's Bluetooth settings, not in-app, so unlike the BLE flow
 * there is no native scan picker — we list the bonded devices and let the
 * user tap one. Resolves null on cancel.
 */

import type { SPPDevice } from "../plugins/BluetoothSerial";

export function showSppDevicePicker(
  devices: SPPDevice[],
): Promise<SPPDevice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "Choose Bluetooth GPS";
    card.appendChild(title);

    const close = (choice: SPPDevice | null) => {
      overlay.remove();
      resolve(choice);
    };

    const list = document.createElement("div");
    list.className = "screen-timeout-buttons";
    list.style.flexDirection = "column";
    for (const device of devices) {
      const btn = document.createElement("button");
      btn.className = "screen-timeout-btn primary";
      btn.textContent = device.name;
      btn.addEventListener("click", () => close(device));
      list.appendChild(btn);
    }
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "screen-timeout-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => close(null));
    list.appendChild(cancelBtn);
    card.appendChild(list);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}
