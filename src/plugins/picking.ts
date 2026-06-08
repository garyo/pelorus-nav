/**
 * Pick-contributor registry.
 *
 * Plugin overlays contribute candidate features at a clicked point; the chart
 * FeatureQueryHandler owns the single click handler and merges these candidates
 * into its one cyclable feature-info list, so a tide/current station no longer
 * "eats" the click — the user can scroll through the station and any nearby
 * light, buoy, or chart feature in the usual prev/next list.
 */

import type { FeatureInfo } from "../chart/feature-info";

export interface PickPoint {
  x: number;
  y: number;
}

export interface PickContributor {
  /** Feature infos at this screen point, topmost first; [] if none. */
  collect(point: PickPoint): FeatureInfo[];
}

export class PickRegistry {
  private readonly contributors: PickContributor[] = [];

  register(c: PickContributor): () => void {
    this.contributors.push(c);
    return () => {
      const i = this.contributors.indexOf(c);
      if (i >= 0) this.contributors.splice(i, 1);
    };
  }

  /** Gather candidates from every contributor at the given screen point. */
  collectAll(point: PickPoint): FeatureInfo[] {
    return this.contributors.flatMap((c) => {
      try {
        return c.collect(point);
      } catch {
        return [];
      }
    });
  }
}
