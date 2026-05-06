package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.cos
import kotlin.random.Random

/**
 * Unit tests for [SteadinessTracker].
 *
 * Coordinates: tests construct fixes by adding (Δx, Δy) metres to a base
 * lat/lon and converting back via the same M_PER_DEG = 111 111 used in the
 * tracker, so the perpendicular-distance arithmetic round-trips exactly.
 */
class SteadinessTrackerTest {

    private val baseLat = 42.0
    private val baseLon = -71.0
    private val cosBase = cos(baseLat * PI / 180.0)
    private val mPerDeg = 111_111.0

    /** Add (xMetres east, yMetres north) to base, return (lat, lon). */
    private fun pt(xMetres: Double, yMetres: Double): Pair<Double, Double> {
        val lat = baseLat + yMetres / mPerDeg
        val lon = baseLon + xMetres / (mPerDeg * cosBase)
        return lat to lon
    }

    private fun SteadinessTracker.feed(x: Double, y: Double): Boolean {
        val (lat, lon) = pt(x, y)
        return onFix(lat, lon)
    }

    @Test
    fun `returns false until buffer fills`() {
        val t = SteadinessTracker(historySize = 5, promoteAfterFixes = 3)
        for (i in 0 until 4) {
            assertFalse("fix $i should not promote yet", t.feed(i * 10.0, 0.0))
        }
    }

    @Test
    fun `promotes after K plus PROMOTE_AFTER fixes on a perfect line`() {
        val t = SteadinessTracker(historySize = 5, promoteAfterFixes = 3)
        // Fixes 0..4 fill buffer (return false).
        for (i in 0 until 5) assertFalse(t.feed(i * 10.0, 0.0))
        // Fixes 5,6 build streak but don't promote yet.
        assertFalse("streak=1", t.feed(50.0, 0.0))
        assertFalse("streak=2", t.feed(60.0, 0.0))
        // Fix 7: streak=3, promote.
        assertTrue("streak=3 → promote", t.feed(70.0, 0.0))
        // Continued straight line: stays promoted.
        assertTrue(t.feed(80.0, 0.0))
        assertTrue(t.feed(90.0, 0.0))
    }

    @Test
    fun `tolerates small jitter that would fool an endpoints-anchored line`() {
        val t = SteadinessTracker(
            historySize = 5,
            deviationThresholdM = 25.0,
            promoteAfterFixes = 3,
        )
        // Generate a straight line at 5 m/step in x with ±5 m Gaussian-ish
        // jitter. With best-fit averaging, the new fix's residual against
        // the fit of the previous five should stay well under threshold.
        val rng = Random(0xC0FFEE)
        var promoted = false
        for (i in 0 until 12) {
            val jitter = (rng.nextDouble() - 0.5) * 10.0  // ±5 m
            val res = t.feed(i * 5.0, jitter)
            if (res) promoted = true
        }
        assertTrue("should promote despite small jitter", promoted)
    }

    @Test
    fun `single off-line fix resets the streak`() {
        val t = SteadinessTracker(historySize = 5, promoteAfterFixes = 3)
        for (i in 0 until 5) t.feed(i * 10.0, 0.0)
        assertFalse(t.feed(50.0, 0.0))   // streak=1
        assertFalse(t.feed(60.0, 0.0))   // streak=2
        assertFalse(t.feed(70.0, 200.0)) // way off: streak=0
        assertFalse(t.feed(80.0, 0.0))   // streak=1 again
    }

    @Test
    fun `sharp 90 degree turn demotes immediately and re-promotes after course establishes`() {
        val t = SteadinessTracker(historySize = 5, promoteAfterFixes = 3)
        // Establish straight east course and promote.
        for (i in 0 until 5) t.feed(i * 10.0, 0.0)
        for (i in 5 until 8) t.feed(i * 10.0, 0.0)
        // Sanity: at fix 7 we should be promoted — re-issue an in-line fix.
        assertTrue(t.feed(80.0, 0.0))

        // Sharp turn: now heading north, away from the previous east-going fit.
        // First post-turn fix has a large residual relative to the east-line
        // fit of the previous five, so it demotes.
        assertFalse(
            "first turn-direction fix should demote",
            t.feed(80.0, 50.0),
        )

        // Continue north for several fixes — the buffer rolls in northbound
        // points, the fit eventually points north, and we re-promote.
        var rePromoted = false
        for (i in 1..15) {
            if (t.feed(80.0, 50.0 + i * 10.0)) {
                rePromoted = true
                break
            }
        }
        assertTrue("should re-promote on the new northbound course", rePromoted)
    }

    @Test
    fun `single noisy fix just under threshold does not demote`() {
        val t = SteadinessTracker(
            historySize = 5,
            deviationThresholdM = 25.0,
            promoteAfterFixes = 3,
        )
        for (i in 0 until 5) t.feed(i * 10.0, 0.0)
        // Build streak to 2.
        assertFalse(t.feed(50.0, 0.0))
        assertFalse(t.feed(60.0, 0.0))
        // Now a noisy fix ~20 m off: fit absorbs, residual stays under 25 m.
        // Streak should advance to 3 and promote.
        val promoted = t.feed(70.0, 20.0)
        assertTrue("near-threshold noise should not demote", promoted)
    }

    @Test
    fun `reset clears buffer and streak`() {
        val t = SteadinessTracker(historySize = 5, promoteAfterFixes = 3)
        for (i in 0 until 8) t.feed(i * 10.0, 0.0)
        // Should be promoted by fix 8.
        // Reset and verify buffer-fill behavior again.
        t.reset()
        for (i in 0 until 4) {
            assertFalse(
                "post-reset fix $i should not promote",
                t.feed(i * 10.0, 0.0),
            )
        }
    }

}
