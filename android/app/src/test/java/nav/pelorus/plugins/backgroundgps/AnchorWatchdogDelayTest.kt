package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The watchdog is the sole caller of the detector's GPS-loss check, so its
 * next delay must be defined in every alarm state — the reviewed field
 * failure was the announced-alarm state returning "never", which left an
 * acknowledged alarm's watch unable to detect GPS loss for the rest of the
 * night.
 */
class AnchorWatchdogDelayTest {
    private val min = 5_000L

    private fun delay(
        alarmKind: String?,
        announced: Boolean,
        deadline: Long = 120_000L,
        lastKeepalive: Long = -1L,
        now: Long = 0L,
    ) = AnchorWatchDetector.watchdogDelayMs(
        alarmKind, announced, deadline, lastKeepalive, now, min,
    )

    @Test
    fun `no alarm waits for the GPS-loss deadline, floored`() {
        assertEquals(120_000L, delay(null, announced = false))
        assertEquals(min, delay(null, announced = false, deadline = 1_000L, now = 90_000L))
    }

    @Test
    fun `suppressed alarm waits for the keepalive verdict to flip`() {
        assertEquals(
            ANCHOR_KEEPALIVE_STALE_MS - 10_000L,
            delay(ANCHOR_ALARM_DRAG, announced = false, lastKeepalive = 0L, now = 10_000L),
        )
        assertEquals(
            min,
            delay(ANCHOR_ALARM_DRAG, announced = false, lastKeepalive = 0L, now = 60_000L),
        )
    }

    @Test
    fun `announced alarm keeps ticking at the floor, never never`() {
        assertEquals(min, delay(ANCHOR_ALARM_DRAG, announced = true))
        assertEquals(min, delay(ANCHOR_ALARM_GPS_LOSS, announced = true))
    }
}
