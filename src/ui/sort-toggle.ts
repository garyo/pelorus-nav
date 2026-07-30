/**
 * Header button for the manager panels that toggles the shared
 * routes/waypoints sort order (name A–Z ⇄ most recent first). The icon
 * shows the current mode; the persisted managerSort setting keeps both
 * panels in step.
 */

import { getSettings, onSettingsChange, updateSettings } from "../settings";
import { iconClock, iconSortAlpha, setIcon } from "./icons";

export function wireSortToggle(btn: HTMLElement, onChange: () => void): void {
  const sync = () => {
    const sort = getSettings().managerSort;
    setIcon(btn, sort === "name" ? iconSortAlpha : iconClock);
    btn.title =
      sort === "name"
        ? "Sorted by name — switch to most recent first"
        : "Sorted by most recent — switch to name order";
  };
  sync();
  // Keep the icon current when the other panel's button flips the setting.
  onSettingsChange(sync);
  btn.addEventListener("click", () => {
    updateSettings({
      managerSort: getSettings().managerSort === "name" ? "recent" : "name",
    });
    onChange();
  });
}
