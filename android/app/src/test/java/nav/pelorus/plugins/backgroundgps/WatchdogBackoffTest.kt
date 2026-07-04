package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Test

class WatchdogBackoffTest {
    @Test
    fun `delays stretch 90s to 15min cap on fruitless kicks`() {
        val b = WatchdogBackoff()
        assertEquals(90_000L, b.nextDelayMs())
        b.onKickFruitless()
        assertEquals(300_000L, b.nextDelayMs())
        b.onKickFruitless()
        assertEquals(600_000L, b.nextDelayMs())
        b.onKickFruitless()
        assertEquals(900_000L, b.nextDelayMs())
        b.onKickFruitless() // beyond the table — stays at the cap
        assertEquals(900_000L, b.nextDelayMs())
    }

    @Test
    fun `reset returns to the base delay`() {
        val b = WatchdogBackoff()
        repeat(5) { b.onKickFruitless() }
        b.reset()
        assertEquals(90_000L, b.nextDelayMs())
    }
}
