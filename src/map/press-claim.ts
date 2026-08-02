/**
 * Which feature owns the current press-and-hold on the map canvas.
 *
 * Two long-presses live on the same canvas: the map's context menu (500 ms
 * anywhere) and dragging a waypoint (a shorter hold, on the waypoint itself).
 * They must not both fire. The shorter hold arms first and claims the press;
 * the context menu checks the claim before showing and stands down.
 *
 * A single module-level claim is enough — there is one canvas, and a press is
 * one finger by definition. The claim is released when the gesture ends.
 */

let claimed = false;

/** Take ownership of the in-flight press (called when a hold arms). */
export function claimMapPress(): void {
  claimed = true;
}

/** Give the press back, at the end of the gesture that claimed it. */
export function releaseMapPress(): void {
  claimed = false;
}

/** True while something other than the caller owns this press. */
export function isMapPressClaimed(): boolean {
  return claimed;
}
