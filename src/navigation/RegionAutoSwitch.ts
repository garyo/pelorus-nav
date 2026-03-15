/**
 * Auto-switch the active chart region based on GPS position.
 *
 * Subscribes to NavigationDataManager and uses bbox containment
 * to detect when the vessel has moved into a different region.
 * Requires 3 consecutive fixes in the new region before switching,
 * to avoid flapping at region boundaries.
 */
import { findRegionForPosition } from "../data/chart-catalog";
import { getSettings, updateSettings } from "../settings";
import type { NavigationDataManager } from "./NavigationDataManager";

const CONSECUTIVE_THRESHOLD = 3;

export class RegionAutoSwitch {
  private consecutiveCount = 0;
  private candidateRegionId: string | null = null;

  constructor(navManager: NavigationDataManager) {
    navManager.subscribe((data) => {
      const region = findRegionForPosition(data.latitude, data.longitude);
      if (!region) {
        // Outside all known regions — reset counter
        this.consecutiveCount = 0;
        this.candidateRegionId = null;
        return;
      }

      const currentRegionId = getSettings().activeRegion;
      if (region.id === currentRegionId) {
        // Still in the current region — reset any pending switch
        this.consecutiveCount = 0;
        this.candidateRegionId = null;
        return;
      }

      // In a different region
      if (region.id === this.candidateRegionId) {
        this.consecutiveCount++;
      } else {
        this.candidateRegionId = region.id;
        this.consecutiveCount = 1;
      }

      if (this.consecutiveCount >= CONSECUTIVE_THRESHOLD) {
        updateSettings({ activeRegion: region.id });
        this.consecutiveCount = 0;
        this.candidateRegionId = null;
      }
    });
  }
}
