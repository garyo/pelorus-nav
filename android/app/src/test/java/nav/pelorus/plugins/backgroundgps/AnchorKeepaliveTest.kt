package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The alarm-authority rule: the JS watch is the authoritative detector while
 * its keepalive beats are fresh; the native detector announces only when they
 * are stale or never happened. Mirrors the heartbeat in
 * src/anchor/native-anchor-watch.ts.
 */
class AnchorKeepaliveTest {

    @Test
    fun `a fresh keepalive proves the JS watch alive and suppresses native announce`() {
        val last = 100_000L
        val now = last + ANCHOR_KEEPALIVE_STALE_MS - 1
        assertTrue(jsWatchAlive(last, now))
        assertFalse(nativeMayAnnounce(last, now))
    }

    @Test
    fun `a stale keepalive hands authority to the native detector`() {
        val last = 100_000L
        val now = last + ANCHOR_KEEPALIVE_STALE_MS + 60_000
        assertFalse(jsWatchAlive(last, now))
        assertTrue(nativeMayAnnounce(last, now))
    }

    @Test
    fun `exactly at the stale threshold counts as stale`() {
        val last = 100_000L
        val now = last + ANCHOR_KEEPALIVE_STALE_MS
        assertFalse(jsWatchAlive(last, now))
        assertTrue(nativeMayAnnounce(last, now))
    }

    @Test
    fun `no keepalive this watch means full native authority`() {
        // JS never connected — e.g. the process was killed and the service
        // restored the watch from disk alone. It must still alarm.
        assertFalse(jsWatchAlive(-1L, 0L))
        assertTrue(nativeMayAnnounce(-1L, 0L))
        assertTrue(nativeMayAnnounce(-1L, 5_000_000L))
    }

    @Test
    fun `a beat at the current instant is fresh`() {
        assertTrue(jsWatchAlive(42_000L, 42_000L))
        assertFalse(nativeMayAnnounce(42_000L, 42_000L))
    }
}
