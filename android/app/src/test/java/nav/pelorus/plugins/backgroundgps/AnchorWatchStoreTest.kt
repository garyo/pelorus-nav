package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The persisted-watch codec. Everything a restarted service knows about the
 * watch it is resuming comes through here, so a record it cannot read back
 * exactly is a watch that resumes on the wrong geometry.
 */
class AnchorWatchStoreTest {

    private val params = AnchorWatchParams(
        lat = 42.363559,
        lon = -71.047973,
        radiusM = 47.5,
        alarmDelayMs = 15_000L,
        gpsLossAlarmMs = 120_000L,
        reAlarmMarginM = 8.0,
    )

    @Test
    fun `round-trips an armed watch exactly`() {
        assertEquals(params, decodeAnchorWatchParams(encodeAnchorWatchParams(params)))
    }

    @Test
    fun `round-trips a southern-hemisphere anchor`() {
        val southern = params.copy(lat = -33.8688, lon = 151.2093)
        assertEquals(southern, decodeAnchorWatchParams(encodeAnchorWatchParams(southern)))
    }

    @Test
    fun `reads nothing when nothing was stored`() {
        assertNull(decodeAnchorWatchParams(null))
        assertNull(decodeAnchorWatchParams(""))
    }

    @Test
    fun `rejects records it does not understand`() {
        val encoded = encodeAnchorWatchParams(params)
        // A future format, a truncated record, and a corrupted field must all
        // read as "no watch" rather than as an approximate one.
        assertNull(decodeAnchorWatchParams(encoded.replaceFirst("1|", "2|")))
        assertNull(decodeAnchorWatchParams(encoded.substringBeforeLast("|")))
        assertNull(decodeAnchorWatchParams(encoded.replace("47.5", "abc")))
    }

    @Test
    fun `rejects a watch nothing could satisfy`() {
        assertNull(decodeAnchorWatchParams(encodeAnchorWatchParams(params.copy(radiusM = 0.0))))
        assertNull(
            decodeAnchorWatchParams(encodeAnchorWatchParams(params.copy(lat = Double.NaN))),
        )
        assertNull(
            decodeAnchorWatchParams(encodeAnchorWatchParams(params.copy(gpsLossAlarmMs = 0L))),
        )
    }
}
