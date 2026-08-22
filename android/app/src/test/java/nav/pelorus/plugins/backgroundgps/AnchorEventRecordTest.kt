package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Test

class AnchorEventRecordTest {
    private val fmt: (Long) -> String = { "t$it" }

    @Test
    fun `body lines are true at read time for each kind`() {
        assertEquals(
            "lost GPS signal, fix returned",
            anchorAlarmEventLine(ANCHOR_ALARM_GPS_LOSS, null),
        )
        assertEquals(
            "lost GPS signal, waiting for fix",
            anchorAlarmEventLine(ANCHOR_ALARM_WATCH_FAILURE, ANCHOR_WATCH_FAILURE_NOTHING_WATCHING),
        )
        assertEquals(
            "device battery low",
            anchorAlarmEventLine(ANCHOR_ALARM_WATCH_FAILURE, ANCHOR_WATCH_FAILURE_DEVICE_BATTERY),
        )
        assertEquals(
            "dragging detected, back inside the circle",
            anchorAlarmEventLine(ANCHOR_ALARM_DRAG, null),
        )
    }

    @Test
    fun `both GPS kinds share the title label`() {
        assertEquals("GPS signal lost", anchorAlarmEventTitleLabel(ANCHOR_ALARM_GPS_LOSS, null))
        assertEquals(
            "GPS signal lost",
            anchorAlarmEventTitleLabel(
                ANCHOR_ALARM_WATCH_FAILURE,
                ANCHOR_WATCH_FAILURE_NOTHING_WATCHING,
            ),
        )
    }

    @Test
    fun `single event title names the event plainly`() {
        val events = listOf(AnchorAlarmEvent(ANCHOR_ALARM_GPS_LOSS, null, 1L))
        assertEquals("Anchor alarm: GPS signal lost", anchorEventRecordTitle(events))
    }

    @Test
    fun `repeated events title carries the count and the latest`() {
        val events = listOf(
            AnchorAlarmEvent(ANCHOR_ALARM_GPS_LOSS, null, 1L),
            AnchorAlarmEvent(ANCHOR_ALARM_DRAG, null, 2L),
        )
        assertEquals("Anchor alarms (2): dragging detected", anchorEventRecordTitle(events))
    }

    @Test
    fun `body lists newest first and ends with the reassurance`() {
        val events = listOf(
            AnchorAlarmEvent(ANCHOR_ALARM_GPS_LOSS, null, 1L),
            AnchorAlarmEvent(ANCHOR_ALARM_DRAG, null, 2L),
        )
        assertEquals(
            "t2 — dragging detected, back inside the circle\n" +
                "t1 — lost GPS signal, fix returned\n" +
                "Still armed.",
            anchorEventRecordText(events, fmt),
        )
    }
}
