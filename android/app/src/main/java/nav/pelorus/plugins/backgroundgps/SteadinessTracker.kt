package nav.pelorus.plugins.backgroundgps

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Decides whether the boat is sailing a straight enough course that the
 * passive GPS-sampling interval can be slowed down. Pure-logic class — no
 * Android dependencies — so it's directly unit-testable.
 *
 * Algorithm: orthogonal best-fit (total least squares) line through the
 * last [historySize] fixes. For each new fix, compute its perpendicular
 * distance to the fit built from the *previous* `historySize` fixes — i.e.
 * the new fix is tested against an established trajectory it hasn't yet
 * contributed to, so a real direction change shows up immediately as a
 * large residual.
 *
 * Best-fit beats a naive endpoints-anchored line: per-point GPS noise
 * shifts the best-fit direction by ~1/N of its own jitter, so the fit
 * stays steady while still tracking a real course change cleanly.
 *
 * Promotes to "steady" after [promoteAfterFixes] consecutive in-line fixes
 * once the buffer is full. Demotes immediately on any single fix whose
 * residual exceeds [deviationThresholdM]; with N=5 averaging, sailing-
 * scale GPS noise is unlikely to cross the threshold, so single-fix demote
 * is safe and yields the fastest possible turn response.
 */
class SteadinessTracker(
    private val historySize: Int = 5,
    private val deviationThresholdM: Double = 25.0,
    private val promoteAfterFixes: Int = 3,
) {
    private data class Fix(val lat: Double, val lon: Double)

    private val history = ArrayDeque<Fix>(historySize + 1)
    private var streak = 0

    /**
     * Feed a new GPS fix. Returns true when the recent track is steady
     * enough to slow down sampling, false otherwise. The boolean is the
     * recommendation each time — the caller compares to the previous value
     * to decide whether to re-apply the LocationRequest.
     */
    fun onFix(lat: Double, lon: Double): Boolean {
        if (history.size < historySize) {
            history.addLast(Fix(lat, lon))
            return false
        }
        val dev = perpDistanceMetres(lat, lon, history)
        streak = if (dev <= deviationThresholdM) streak + 1 else 0
        history.removeFirst()
        history.addLast(Fix(lat, lon))
        return streak >= promoteAfterFixes
    }

    /** Drop all history and reset the streak. Call on mode transitions. */
    fun reset() {
        history.clear()
        streak = 0
    }

    private fun perpDistanceMetres(
        pLat: Double,
        pLon: Double,
        hist: ArrayDeque<Fix>,
    ): Double {
        // Project history into local meters relative to (pLat, pLon). The
        // new fix is at the origin in this frame.
        val cosLat = cos(pLat * PI / 180.0)
        val xs = DoubleArray(hist.size)
        val ys = DoubleArray(hist.size)
        var meanX = 0.0
        var meanY = 0.0
        var i = 0
        for (h in hist) {
            xs[i] = (h.lon - pLon) * METRES_PER_DEG * cosLat
            ys[i] = (h.lat - pLat) * METRES_PER_DEG
            meanX += xs[i]
            meanY += ys[i]
            i++
        }
        meanX /= hist.size
        meanY /= hist.size

        var sxx = 0.0
        var syy = 0.0
        var sxy = 0.0
        for (k in xs.indices) {
            val dx = xs[k] - meanX
            val dy = ys[k] - meanY
            sxx += dx * dx
            syy += dy * dy
            sxy += dx * dy
        }

        // Degenerate cluster (boat stationary, all fixes piled up): no
        // meaningful line direction. Treat as "in line" — the residual
        // would already be tiny anyway.
        if (sxx + syy < 1.0) return 0.0

        val theta = 0.5 * atan2(2.0 * sxy, sxx - syy)
        // p is at the origin (0, 0); perpendicular distance from the line
        // through (meanX, meanY) at angle theta:
        //   d = | sinθ · (px − meanX) − cosθ · (py − meanY) |
        return abs(sin(theta) * -meanX - cos(theta) * -meanY)
    }

    companion object {
        private const val METRES_PER_DEG = 111_111.0
    }
}
