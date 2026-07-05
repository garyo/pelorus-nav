/**
 * Tracks lattice keys with a fetch currently in flight, so an overlapping
 * refresh (e.g. triggered by panning again before a slow fetch settles)
 * doesn't re-request the same missing points. Keys are removed once their
 * fetch settles — success or failure — so a failed fetch is retried on the
 * next refresh (still subject to the caller's own rate-limit backoff).
 */
export class InFlightTracker {
  private readonly keys = new Set<string>();

  /** Points not currently being fetched. */
  filterNew<T extends { key: string }>(points: T[]): T[] {
    return points.filter((p) => !this.keys.has(p.key));
  }

  /** Mark these points as in flight (call right before fetching them). */
  begin(points: Array<{ key: string }>): void {
    for (const p of points) this.keys.add(p.key);
  }

  /** Clear these points' in-flight status (call once the fetch settles). */
  end(points: Array<{ key: string }>): void {
    for (const p of points) this.keys.delete(p.key);
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }
}
