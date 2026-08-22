package nav.pelorus.plugins.backgroundgps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Append the correct NMEA checksum to a body (no leading $). */
private fun withChecksum(body: String): String {
    var sum = 0
    for (c in body) sum = sum xor c.code
    return "\$$body*%02X".format(sum)
}

class NmeaRmcTest {
    private val validBody =
        "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W"

    @Test
    fun `parses a valid RMC into decimal degrees`() {
        val fix = parseNmeaRmc(withChecksum(validBody))
        assertNotNull(fix)
        assertEquals(48.1173, fix!!.lat, 1e-4)
        assertEquals(11.5166, fix.lon, 1e-4)
    }

    @Test
    fun `southern and western hemispheres are negative`() {
        val fix = parseNmeaRmc(
            withChecksum("GNRMC,123519,A,4216.8342,S,07105.2168,W,0.1,0.0,230394,,"),
        )
        assertNotNull(fix)
        assertEquals(-42.28057, fix!!.lat, 1e-4)
        assertEquals(-71.086946, fix.lon, 1e-4)
    }

    @Test
    fun `rejects a void fix, a bad checksum, and a missing checksum`() {
        assertNull(parseNmeaRmc(withChecksum(validBody.replace(",A,", ",V,"))))
        assertNull(parseNmeaRmc("\$$validBody*00"))
        assertNull(parseNmeaRmc("\$$validBody"))
    }

    @Test
    fun `rejects non-RMC and proprietary sentences`() {
        assertNull(parseNmeaRmc(withChecksum("GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,")))
        // Garmin's $PGRMC shares the suffix but not the field layout.
        assertNull(parseNmeaRmc(withChecksum("PGRMC,A,4807.038,N,01131.000,E,,,,,,,,,")))
        assertNull(parseNmeaRmc("not nmea at all"))
        assertNull(parseNmeaRmc(""))
    }

    @Test
    fun `rejects corrupt coordinates rather than guessing`() {
        assertNull(parseNmeaRmc(withChecksum("GPRMC,123519,A,48o7.038,N,01131.000,E,0,0,230394,,")))
        assertNull(parseNmeaRmc(withChecksum("GPRMC,123519,A,4807.038,X,01131.000,E,0,0,230394,,")))
        // Minutes must stay under 60.
        assertNull(parseNmeaRmc(withChecksum("GPRMC,123519,A,4877.038,N,01131.000,E,0,0,230394,,")))
    }
}

class NmeaLineAssemblerTest {
    @Test
    fun `reassembles sentences split across chunks`() {
        val a = NmeaLineAssembler()
        assertEquals(emptyList<String>(), a.feed("\$GPRMC,123"))
        assertEquals(listOf("\$GPRMC,123519,A*XX"), a.feed("519,A*XX\r\n"))
    }

    @Test
    fun `returns every complete line in a chunk`() {
        val a = NmeaLineAssembler()
        assertEquals(listOf("one", "two"), a.feed("one\r\ntwo\nthr"))
        assertEquals(listOf("three"), a.feed("ee\n"))
    }

    @Test
    fun `drops an unbounded line instead of buffering it forever`() {
        val a = NmeaLineAssembler(maxLine = 16)
        assertEquals(emptyList<String>(), a.feed("x".repeat(100)))
        // The truncated tail terminates at the newline; the next real
        // sentence parses normally.
        a.feed("junk\n")
        assertEquals(listOf("\$GPRMC,ok"), a.feed("\$GPRMC,ok\n").filter { it.startsWith("$") })
    }
}
