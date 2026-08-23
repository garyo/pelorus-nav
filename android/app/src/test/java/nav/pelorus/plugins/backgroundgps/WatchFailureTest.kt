package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The watch-failure meta-alarm's two pure trigger machines, plus the sound
 * priority and volume floor that give it its quieter voice. Mirrors the JS
 * adoption tests in src/anchor/AnchorWatchManager.test.ts.
 */
class WatchFailureTest {

    // --- Trigger A: nothing is watching --------------------------------

    @Test
    fun `fires only after the condition persists past the window`() {
        val m = NothingWatchingMonitor()
        // JS never beat, no fix ever: the condition holds from the first check.
        assertEquals(
            WatchFailureTransition.NONE,
            m.check(hadFix = false, lastKeepaliveElapsedMs = -1L, nowElapsedMs = 0L),
        )
        assertEquals(
            WatchFailureTransition.NONE,
            m.check(false, -1L, NOTHING_WATCHING_PERSIST_MS - 1),
        )
        assertEquals(
            WatchFailureTransition.RAISE,
            m.check(false, -1L, NOTHING_WATCHING_PERSIST_MS),
        )
        assertTrue(m.alarming)
        // Unchanged condition: raised once, never periodically.
        assertEquals(
            WatchFailureTransition.NONE,
            m.check(false, -1L, NOTHING_WATCHING_PERSIST_MS + 60_000),
        )
    }

    @Test
    fun `a fresh keepalive is not silence, and 60 s of it is`() {
        val m = NothingWatchingMonitor()
        // Beat 59 s ago: stale for alarm authority, but not yet "gone".
        assertEquals(
            WatchFailureTransition.NONE,
            m.check(false, 0L, NOTHING_WATCHING_KEEPALIVE_SILENT_MS - 1_000),
        )
        // The clock must not have started: a full persist window after a beat
        // 61 s old still needs the window from when silence crossed 60 s.
        val t0 = NOTHING_WATCHING_KEEPALIVE_SILENT_MS
        assertEquals(WatchFailureTransition.NONE, m.check(false, 0L, t0))
        assertEquals(
            WatchFailureTransition.NONE,
            m.check(false, 0L, t0 + NOTHING_WATCHING_PERSIST_MS - 1),
        )
        assertEquals(
            WatchFailureTransition.RAISE,
            m.check(false, 0L, t0 + NOTHING_WATCHING_PERSIST_MS),
        )
    }

    @Test
    fun `arming indoors and walking to the boat does not false-fire`() {
        val m = NothingWatchingMonitor()
        // Screen off in a pocket, keepalive long silent, no fix yet: the
        // condition holds through the two-minute walk out to the mooring…
        assertEquals(WatchFailureTransition.NONE, m.check(false, -1L, 0L))
        assertEquals(WatchFailureTransition.NONE, m.check(false, -1L, 120_000L))
        // …then the first GNSS fix on deck ends it, timer and all.
        assertEquals(WatchFailureTransition.NONE, m.check(true, -1L, 150_000L))
        assertFalse(m.alarming)
        // hadFix latches in the detector, so this monitor stays quiet for good.
        assertEquals(WatchFailureTransition.NONE, m.check(true, -1L, 999_000_000L))
    }

    @Test
    fun `a resumed keepalive clears a raised alarm and resets the clock`() {
        val m = NothingWatchingMonitor()
        m.check(false, -1L, 0L)
        assertEquals(WatchFailureTransition.RAISE, m.check(false, -1L, NOTHING_WATCHING_PERSIST_MS))
        // The skipper picked up the phone: JS beats again.
        val resumeAt = NOTHING_WATCHING_PERSIST_MS + 10_000
        assertEquals(WatchFailureTransition.CLEAR, m.check(false, resumeAt, resumeAt))
        assertFalse(m.alarming)
        // It froze again: a fresh condition needs the full window again.
        val frozenAt = resumeAt + NOTHING_WATCHING_KEEPALIVE_SILENT_MS
        assertEquals(WatchFailureTransition.NONE, m.check(false, resumeAt, frozenAt))
        assertEquals(
            WatchFailureTransition.RAISE,
            m.check(false, resumeAt, frozenAt + NOTHING_WATCHING_PERSIST_MS),
        )
    }

    @Test
    fun `acknowledge silences and it re-fires only after clearing and recurring`() {
        val m = NothingWatchingMonitor()
        m.check(false, -1L, 0L)
        m.check(false, -1L, NOTHING_WATCHING_PERSIST_MS)
        assertTrue(m.acknowledge())
        assertFalse(m.alarming)
        // The condition holds unchanged: silence stays silent, forever.
        assertEquals(
            WatchFailureTransition.NONE,
            m.check(false, -1L, NOTHING_WATCHING_PERSIST_MS * 10),
        )
        // Clears (keepalive resumes), then recurs: a fresh alarm.
        val resumeAt = NOTHING_WATCHING_PERSIST_MS * 10 + 5_000
        assertEquals(WatchFailureTransition.NONE, m.check(false, resumeAt, resumeAt))
        val goneAt = resumeAt + NOTHING_WATCHING_KEEPALIVE_SILENT_MS
        m.check(false, resumeAt, goneAt)
        assertEquals(
            WatchFailureTransition.RAISE,
            m.check(false, resumeAt, goneAt + NOTHING_WATCHING_PERSIST_MS),
        )
    }

    @Test
    fun `acknowledging nothing silences nothing`() {
        assertFalse(NothingWatchingMonitor().acknowledge())
    }

    // --- Trigger B: device battery low ---------------------------------

    @Test
    fun `fires once at the low threshold while not charging`() {
        val m = BatteryWatchMonitor()
        assertEquals(WatchFailureTransition.NONE, m.check(50, charging = false, nowElapsedMs = 0L))
        assertEquals(WatchFailureTransition.NONE, m.check(ANCHOR_BATTERY_LOW_PCT + 1, false, 5_000L))
        assertEquals(WatchFailureTransition.RAISE, m.check(ANCHOR_BATTERY_LOW_PCT, false, 10_000L))
        assertTrue(m.alarming)
        // Falling further (above critical) does not re-announce.
        assertEquals(WatchFailureTransition.NONE, m.check(12, false, 15_000L))
    }

    @Test
    fun `never fires while charging, whatever the level`() {
        val m = BatteryWatchMonitor()
        assertEquals(WatchFailureTransition.NONE, m.check(5, charging = true, nowElapsedMs = 0L))
        assertEquals(WatchFailureTransition.NONE, m.check(1, charging = true, nowElapsedMs = 5_000L))
        assertFalse(m.alarming)
    }

    @Test
    fun `acknowledged, it speaks exactly once more at critical`() {
        val m = BatteryWatchMonitor()
        m.check(ANCHOR_BATTERY_LOW_PCT, false, 0L)
        assertTrue(m.acknowledge())
        assertEquals(WatchFailureTransition.NONE, m.check(10, false, 5_000L))
        assertEquals(WatchFailureTransition.RAISE, m.check(ANCHOR_BATTERY_CRITICAL_PCT, false, 10_000L))
        assertTrue(m.alarming)
        assertTrue(m.acknowledge())
        // Third act: there isn't one. The next voice is the device dying.
        assertEquals(WatchFailureTransition.NONE, m.check(3, false, 15_000L))
        assertEquals(WatchFailureTransition.NONE, m.check(1, false, 20_000L))
    }

    @Test
    fun `sustained charging clears the state entirely`() {
        val m = BatteryWatchMonitor()
        m.check(ANCHOR_BATTERY_LOW_PCT, false, 0L)
        assertEquals(WatchFailureTransition.CLEAR, m.check(14, charging = true, nowElapsedMs = 5_000L))
        assertFalse(m.alarming)
        // The charger held long enough: a genuine unplug alarms afresh.
        val resetAt = 5_000L + ANCHOR_BATTERY_RESET_CHARGING_MS
        assertEquals(WatchFailureTransition.NONE, m.check(20, true, resetAt))
        assertEquals(WatchFailureTransition.RAISE, m.check(ANCHOR_BATTERY_LOW_PCT, false, resetAt + 5_000L))
        m.acknowledge()
        assertEquals(
            WatchFailureTransition.RAISE,
            m.check(ANCHOR_BATTERY_CRITICAL_PCT, false, resetAt + 10_000L),
        )
    }

    @Test
    fun `a flapping charger does not re-arm the fired latches`() {
        // A vibrating 12 V plug at 14%: each charging blip silences, but the
        // brief charge must not turn every following unplugged sample into a
        // fresh full alarm.
        val m = BatteryWatchMonitor()
        assertEquals(WatchFailureTransition.RAISE, m.check(14, false, 0L))
        m.acknowledge()
        assertEquals(WatchFailureTransition.NONE, m.check(14, true, 5_000L))
        assertEquals(WatchFailureTransition.NONE, m.check(14, false, 10_000L))
        assertEquals(WatchFailureTransition.NONE, m.check(14, true, 15_000L))
        assertEquals(WatchFailureTransition.NONE, m.check(14, false, 20_000L))
    }

    @Test
    fun `plugging in with no alarm up clears silently after the hold`() {
        val m = BatteryWatchMonitor()
        m.check(ANCHOR_BATTERY_LOW_PCT, false, 0L)
        m.acknowledge()
        // Acknowledged (not alarming): the clear has no noise to stop.
        assertEquals(WatchFailureTransition.NONE, m.check(20, charging = true, nowElapsedMs = 5_000L))
        val resetAt = 5_000L + ANCHOR_BATTERY_RESET_CHARGING_MS
        m.check(20, true, resetAt)
        // The latches are gone: a fresh decline fires again.
        assertEquals(WatchFailureTransition.RAISE, m.check(ANCHOR_BATTERY_LOW_PCT, false, resetAt + 5_000L))
    }

    @Test
    fun `already critical at first sight fires once, not twice`() {
        val m = BatteryWatchMonitor()
        assertEquals(WatchFailureTransition.RAISE, m.check(5, false, 0L))
        assertEquals(WatchFailureTransition.NONE, m.check(4, false, 5_000L))
    }

    @Test
    fun `an unreadable battery changes nothing`() {
        val m = BatteryWatchMonitor()
        m.check(ANCHOR_BATTERY_LOW_PCT, false, 0L)
        assertEquals(WatchFailureTransition.NONE, m.check(-1, false, 5_000L))
        assertTrue(m.alarming)
    }

    @Test
    fun `battery percent survives odd platform scales`() {
        assertEquals(50, batteryPercent(50, 100))
        assertEquals(15, batteryPercent(15, 100))
        assertEquals(50, batteryPercent(2, 4))
        assertEquals(-1, batteryPercent(-1, 100))
        assertEquals(-1, batteryPercent(50, 0))
        assertEquals(-1, batteryPercent(50, -1))
        assertEquals(100, batteryPercent(200, 100))
    }

    // --- Voice: priority and floor --------------------------------------

    @Test
    fun `watch-failure yields to both real alarms, either side`() {
        assertEquals(
            ANCHOR_ALARM_WATCH_FAILURE,
            anchorAlarmSoundKind(ANCHOR_ALARM_WATCH_FAILURE, null),
        )
        assertEquals(
            ANCHOR_ALARM_WATCH_FAILURE,
            anchorAlarmSoundKind(null, ANCHOR_ALARM_WATCH_FAILURE),
        )
        assertEquals(
            ANCHOR_ALARM_DRAG,
            anchorAlarmSoundKind(ANCHOR_ALARM_WATCH_FAILURE, ANCHOR_ALARM_DRAG),
        )
        assertEquals(
            ANCHOR_ALARM_GPS_LOSS,
            anchorAlarmSoundKind(ANCHOR_ALARM_WATCH_FAILURE, ANCHOR_ALARM_GPS_LOSS),
        )
        assertEquals(
            ANCHOR_ALARM_DRAG,
            anchorAlarmSoundKind(ANCHOR_ALARM_DRAG, ANCHOR_ALARM_WATCH_FAILURE),
        )
        assertEquals(
            ANCHOR_ALARM_GPS_LOSS,
            anchorAlarmSoundKind(ANCHOR_ALARM_GPS_LOSS, ANCHOR_ALARM_WATCH_FAILURE),
        )
        assertNull(anchorAlarmSoundKind(null, null))
    }

    @Test
    fun `watch-failure raises to its own lower floor`() {
        assertEquals(
            ANCHOR_WATCH_FAILURE_VOLUME_FLOOR,
            anchorAlarmVolumeFloor(ANCHOR_ALARM_WATCH_FAILURE),
            1e-9,
        )
        assertEquals(ANCHOR_ALARM_VOLUME_FLOOR, anchorAlarmVolumeFloor(ANCHOR_ALARM_DRAG), 1e-9)
        assertEquals(
            ANCHOR_ALARM_VOLUME_FLOOR,
            anchorAlarmVolumeFloor(ANCHOR_ALARM_GPS_LOSS),
            1e-9,
        )
        // 0.6 of a 15-step scale: index 9 — waking, not startling.
        assertEquals(9, anchorAlarmTargetIndex(2, 15, ANCHOR_ALARM_WATCH_FAILURE))
        // Absolute: a louder system level is brought down to the target too.
        assertEquals(9, anchorAlarmTargetIndex(14, 15, ANCHOR_ALARM_WATCH_FAILURE))
        assertEquals(-1, anchorAlarmTargetIndex(9, 15, ANCHOR_ALARM_WATCH_FAILURE))
        // The chirp keeps its quieter relationship at any user setting.
        assertEquals(6, anchorAlarmTargetIndex(2, 15, ANCHOR_ALARM_WATCH_FAILURE, 0.6))
        // The default level is unchanged for the real alarms.
        assertEquals(14, anchorAlarmTargetIndex(9, 15, ANCHOR_ALARM_DRAG))
    }
}
