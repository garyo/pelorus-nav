/**
 * Shared paint tuning for the selected-item halo drawn under the crisp
 * route / track geometry. Kept in one place so Routes and Tracks stay
 * visually in sync.
 */

/** Mix factor toward white applied to the base color (0 = unchanged, 1 = white). */
export const GLOW_LIGHTEN = 0.6;
export const GLOW_OPACITY = 0.7;
export const GLOW_WIDTH = 14;
export const GLOW_BLUR = 5;

/** Waypoint halo tuning (circle layer, used for route waypoints). */
export const GLOW_CIRCLE_RADIUS = 17;
export const GLOW_CIRCLE_BLUR = 0.5;
/**
 * Fixed color for the waypoint halo — a warm orange that contrasts with the
 * blue water backdrop and echoes the waypoint icon's orange fill (#ff8800).
 * Overrides the route-color-derived glow for circles only.
 */
export const GLOW_CIRCLE_COLOR = "#ffbb33";
