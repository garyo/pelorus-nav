package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the JS AnchorWatchManager scenarios in AnchorWatchManager.test.ts. */
class AnchorWatchDetectorTest {

    private val anchorLat = 42.0
    private val anchorLon = -71.0

    /** Meters per degree of latitude at the shared haversine earth radius. */
    private val metersPerDegLat = 111_194.93

    private fun params(radiusM: Double = 50.0) = AnchorWatchParams(
        lat = anchorLat,
        lon = anchorLon,
        radiusM = radiusM,
        alarmDelayMs = 15_000L,
        gpsLossAlarmMs = 120_000L,
        reAlarmMarginM = 8.0,
    )

    /** Latitude of a position `meters` due north of the anchor. */
    private fun latAt(meters: Double) = anchorLat + meters / metersPerDegLat

    private fun fix(d: AnchorWatchDetector, meters: Double, atMs: Long) =
        d.onFix(latAt(meters), anchorLon, atMs)

    @Test
    fun `stays quiet inside the radius`() {
        val d = AnchorWatchDetector(params())
        assertEquals(AnchorTransition.NONE, fix(d, 0.0, 1_000L))
        assertEquals(AnchorTransition.NONE, fix(d, 40.0, 60_000L))
        assertNull(d.alarmKind)
        assertEquals(40.0, d.lastDistanceM, 0.5)
    }

    @Test
    fun `drag alarms only after the delay elapses continuously`() {
        val d = AnchorWatchDetector(params())
        assertEquals(AnchorTransition.NONE, fix(d, 0.0, 0L))
        assertEquals(AnchorTransition.NONE, fix(d, 55.0, 10_000L))
        assertEquals(AnchorTransition.NONE, fix(d, 57.0, 20_000L))
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 58.0, 25_000L))
        assertEquals(ANCHOR_ALARM_DRAG, d.alarmKind)
    }

    @Test
    fun `re-entry inside the radius resets the excursion timer`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        fix(d, 55.0, 10_000L)
        assertEquals(AnchorTransition.NONE, fix(d, 10.0, 20_000L))
        // Fresh excursion: the clock restarts, so 24 s after the first exit
        // is still quiet.
        assertEquals(AnchorTransition.NONE, fix(d, 55.0, 24_000L))
        assertNull(d.alarmKind)
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 55.0, 40_000L))
    }

    @Test
    fun `acknowledge silences but keeps watching`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        fix(d, 55.0, 10_000L)
        fix(d, 55.0, 30_000L)
        assertEquals(ANCHOR_ALARM_DRAG, d.alarmKind)

        assertTrue(d.acknowledge())
        assertNull(d.alarmKind)

        // Drifting a little more does not re-alarm...
        assertEquals(AnchorTransition.NONE, fix(d, 58.0, 45_000L))
        // ...but a further margin beyond the acknowledged distance does.
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 64.0, 60_000L))
    }

    @Test
    fun `returning inside clears an acknowledged drag`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        fix(d, 55.0, 10_000L)
        fix(d, 55.0, 30_000L)
        d.acknowledge()
        assertEquals(AnchorTransition.CLEARED, fix(d, 10.0, 40_000L))
        // Back to a clean slate: a new excursion needs the full delay again.
        assertEquals(AnchorTransition.NONE, fix(d, 55.0, 50_000L))
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 55.0, 70_000L))
    }

    @Test
    fun `gps loss alarms after the timeout, but never before the first fix`() {
        val d = AnchorWatchDetector(params())
        // Armed and blind from the start — never proven to work, so silence.
        assertEquals(AnchorTransition.NONE, d.onTick(500_000L))
        assertNull(d.alarmKind)

        fix(d, 0.0, 600_000L)
        assertEquals(AnchorTransition.NONE, d.onTick(700_000L))
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(720_000L))
        assertEquals(ANCHOR_ALARM_GPS_LOSS, d.alarmKind)
        assertEquals(720_000L, d.gpsLossDeadlineElapsedMs())
    }

    @Test
    fun `a fix clears a gps-loss alarm`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(130_000L))
        assertEquals(AnchorTransition.CLEARED, fix(d, 5.0, 140_000L))
        assertNull(d.alarmKind)
    }

    @Test
    fun `acknowledged gps loss stays silent until a fix arrives`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        d.onTick(130_000L)
        assertTrue(d.acknowledge())
        assertEquals(AnchorTransition.NONE, d.onTick(400_000L))
        // A fix re-proves the watch; a later outage can alarm again.
        fix(d, 0.0, 500_000L)
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(630_000L))
    }

    @Test
    fun `shrinking the radius re-judges the last fix and restarts the timer`() {
        val d = AnchorWatchDetector(params())
        fix(d, 30.0, 0L)
        assertEquals(AnchorTransition.NONE, d.updateParams(params(radiusM = 20.0), 1_000L))
        assertNull(d.alarmKind)
        assertEquals(AnchorTransition.NONE, fix(d, 30.0, 10_000L))
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 30.0, 20_000L))
    }

    @Test
    fun `an external fix holds off the gps-loss alarm without proving the watch`() {
        val d = AnchorWatchDetector(params())
        // Only the app's own GPS (an external Bluetooth receiver) is seeing
        // the boat; the service's own chip never has.
        assertEquals(AnchorTransition.NONE, d.onExternalFix(60_000L))
        assertFalse(d.hadFix)
        assertEquals(AnchorTransition.NONE, d.onTick(200_000L))
        assertNull(d.alarmKind)
    }

    @Test
    fun `external fixes push the gps-loss deadline out`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        assertEquals(AnchorTransition.NONE, d.onExternalFix(100_000L))
        assertEquals(220_000L, d.gpsLossDeadlineElapsedMs())
        assertEquals(AnchorTransition.NONE, d.onTick(200_000L))
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(230_000L))
    }

    @Test
    fun `an external fix clears a sounding gps-loss alarm but not a drag`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(130_000L))
        assertEquals(AnchorTransition.CLEARED, d.onExternalFix(140_000L))
        assertNull(d.alarmKind)

        // A drag is about where the boat is, which an external fix says
        // nothing about — it keeps ringing.
        fix(d, 60.0, 150_000L)
        fix(d, 60.0, 170_000L)
        assertEquals(ANCHOR_ALARM_DRAG, d.alarmKind)
        assertEquals(AnchorTransition.NONE, d.onExternalFix(180_000L))
        assertEquals(ANCHOR_ALARM_DRAG, d.alarmKind)
    }

    @Test
    fun `a fix that ends a gps-loss alarm outside the radius reports the drag`() {
        val d = AnchorWatchDetector(params())
        fix(d, 55.0, 0L)
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(130_000L))
        // Dragged and blind: the drag is the alarm that matters.
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 80.0, 140_000L))
        assertEquals(ANCHOR_ALARM_DRAG, d.alarmKind)
    }

    @Test
    fun `moving the anchor onto the boat clears a sounding drag alarm`() {
        val d = AnchorWatchDetector(params())
        fix(d, 0.0, 0L)
        fix(d, 60.0, 10_000L)
        fix(d, 60.0, 30_000L)
        assertEquals(ANCHOR_ALARM_DRAG, d.alarmKind)
        val moved = params().copy(lat = latAt(60.0))
        assertEquals(AnchorTransition.CLEARED, d.updateParams(moved, 31_000L))
        assertNull(d.alarmKind)
    }

    @Test
    fun `a restored watch keeps the right to alarm on silence`() {
        // Proven before the kill: staying blind after the restart is news.
        val d = AnchorWatchDetector.restored(params(), hadFix = true, nowElapsedMs = 900_000L)
        assertTrue(d.hadFix)
        // The deadline runs from the restart, not from the pre-kill fix.
        assertEquals(1_020_000L, d.gpsLossDeadlineElapsedMs())
        assertEquals(AnchorTransition.NONE, d.onTick(1_000_000L))
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(1_030_000L))
    }

    @Test
    fun `a restored watch that never had a fix still stays silent`() {
        val d = AnchorWatchDetector.restored(params(), hadFix = false, nowElapsedMs = 900_000L)
        assertFalse(d.hadFix)
        assertEquals(AnchorTransition.NONE, d.onTick(2_000_000L))
        assertNull(d.alarmKind)
    }

    @Test
    fun `a restored watch starts with clean hysteresis`() {
        val d = AnchorWatchDetector.restored(params(), hadFix = true, nowElapsedMs = 0L)
        // Outside on the first fix back — but only a full delay of continuous
        // excursion may alarm, never the pre-kill one.
        assertEquals(AnchorTransition.NONE, fix(d, 80.0, 1_000L))
        assertNull(d.alarmKind)
        assertEquals(AnchorTransition.NONE, fix(d, 80.0, 10_000L))
        assertEquals(AnchorTransition.DRAG_ALARM, fix(d, 80.0, 17_000L))
    }

    @Test
    fun `a restored watch carries no acknowledgment`() {
        val d = AnchorWatchDetector.restored(params(), hadFix = true, nowElapsedMs = 0L)
        assertFalse(d.acknowledge())
        // A GPS-loss acknowledgment from before the kill does not silence this
        // watch either.
        assertEquals(AnchorTransition.GPS_LOSS_ALARM, d.onTick(121_000L))
    }

    @Test
    fun `native audio yields only to a JS alarm proven to be audible`() {
        // A started activity is not proof: a WebView back from suspension
        // beats silently until a user gesture unlocks its AudioContext.
        assertTrue(shouldSoundNativeAnchorAlarm(appForeground = true, jsAlarmAudible = false))
        assertTrue(shouldSoundNativeAnchorAlarm(appForeground = false, jsAlarmAudible = false))
        assertTrue(shouldSoundNativeAnchorAlarm(appForeground = false, jsAlarmAudible = true))
        assertFalse(shouldSoundNativeAnchorAlarm(appForeground = true, jsAlarmAudible = true))
    }
}
