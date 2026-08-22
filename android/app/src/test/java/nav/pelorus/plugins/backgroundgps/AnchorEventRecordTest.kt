package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Test

class AnchorEventRecordTest {
    private val fmt: (Long) -> String = { "t$it" }

    @Test
    fun `labels each alarm kind for the record`() {
        assertEquals("Anchor drag detected", anchorAlarmEventLabel(ANCHOR_ALARM_DRAG, null))
        assertEquals("GPS lost", anchorAlarmEventLabel(ANCHOR_ALARM_GPS_LOSS, null))
        assertEquals(
            "Nothing was watching",
            anchorAlarmEventLabel(ANCHOR_ALARM_WATCH_FAILURE, ANCHOR_WATCH_FAILURE_NOTHING_WATCHING),
        )
        assertEquals(
            "Device battery low",
            anchorAlarmEventLabel(ANCHOR_ALARM_WATCH_FAILURE, ANCHOR_WATCH_FAILURE_DEVICE_BATTERY),
        )
    }

    @Test
    fun `single event title names the event plainly`() {
        val events = listOf(AnchorAlarmEvent(ANCHOR_ALARM_GPS_LOSS, null, 1L))
        assertEquals("Anchor alarm earlier: GPS lost", anchorEventRecordTitle(events))
    }

    @Test
    fun `repeated events title carries the count and the latest`() {
        val events = listOf(
            AnchorAlarmEvent(ANCHOR_ALARM_GPS_LOSS, null, 1L),
            AnchorAlarmEvent(
                ANCHOR_ALARM_WATCH_FAILURE,
                ANCHOR_WATCH_FAILURE_NOTHING_WATCHING,
                2L,
            ),
        )
        assertEquals(
            "Anchor alarms earlier (2) — Nothing was watching",
            anchorEventRecordTitle(events),
        )
    }

    @Test
    fun `body lists newest first and ends with the reassurance`() {
        val events = listOf(
            AnchorAlarmEvent(ANCHOR_ALARM_GPS_LOSS, null, 1L),
            AnchorAlarmEvent(ANCHOR_ALARM_DRAG, null, 2L),
        )
        assertEquals(
            "t2 · Anchor drag detected\n" +
                "t1 · GPS lost\n" +
                "Each cleared on its own; the watch is still armed.",
            anchorEventRecordText(events, fmt),
        )
    }
}
