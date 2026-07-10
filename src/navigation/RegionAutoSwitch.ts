/**
 * Auto-switch the active chart region when the vessel crosses into a
 * different region.
 *
 * Edge-triggered on the vessel's own region changing — never on a mere
 * mismatch between GPS position and the active region — so a manual
 * selection in the Regions panel sticks while the boat stays put (a
 * level-triggered check used to snap it back within seconds). Sailing into
 * a new region, or opening the app after relocating, still switches.
 * Requires 3 consecutive fixes in the new region before acting, to avoid
 * flapping at region boundaries.
 */
import { findRegionForPosition } from "../data/chart-catalog";
import { getSettings, updateSettings } from "../settings";
import type { NavigationDataManager } from "./NavigationDataManager";

const CONSECUTIVE_THRESHOLD = 3;

export class RegionAutoSwitch {
  /**
   * Region the vessel is settled in (null = outside all regions);
   * undefined until the first post-construction settle.
   */
  private settledRegionId: string | null | undefined = undefined;
  /** Pending new region being confirmed; undefined = none pending. */
  private candidateRegionId: string | null | undefined = undefined;
  private consecutiveCount = 0;
  /**
   * The very first settle also corrects a stale region (boat relocated
   * while the app was closed) — but only if the user hasn't already picked
   * a region since launch, else the settle races a fresh manual choice.
   */
  private readonly initialActiveRegion = getSettings().activeRegion;

  constructor(navManager: NavigationDataManager) {
    navManager.subscribe((data) => {
      const region = findRegionForPosition(data.latitude, data.longitude);
      const regionId = region?.id ?? null;

      if (regionId === this.settledRegionId) {
        // Steady state — no crossing, nothing to confirm.
        this.candidateRegionId = undefined;
        this.consecutiveCount = 0;
        return;
      }

      if (regionId === this.candidateRegionId) {
        this.consecutiveCount++;
      } else {
        this.candidateRegionId = regionId;
        this.consecutiveCount = 1;
      }

      if (this.consecutiveCount >= CONSECUTIVE_THRESHOLD) {
        const wasFirstSettle = this.settledRegionId === undefined;
        this.settledRegionId = this.candidateRegionId ?? null;
        const active = getSettings().activeRegion;
        if (
          this.settledRegionId &&
          this.settledRegionId !== active &&
          (!wasFirstSettle || active === this.initialActiveRegion)
        ) {
          updateSettings({ activeRegion: this.settledRegionId });
        }
        this.candidateRegionId = undefined;
        this.consecutiveCount = 0;
      }
    });
  }
}
