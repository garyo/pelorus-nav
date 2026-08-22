package nav.pelorus.plugins.backgroundgps

/**
 * Minimal NMEA position extraction for the native anchor watch.
 *
 * A GNSS-less tablet's only position source is an external receiver the app
 * reads over a native serial transport (see BluetoothSerialPlugin). The
 * WebView that normally parses that stream is frozen within a couple of
 * minutes of the screen going off — measured on every device tried, renderer
 * priority pinned or not — so screen-off anchor detection must not depend on
 * it. Feeding positions parsed *natively* into the anchor detector gives such
 * devices the same screen-off cover a phone gets from its own GNSS chip.
 *
 * Only RMC is read: every GNSS receiver emits it, and its validity flag and
 * position are all the detector needs. Anything else — proprietary sentences,
 * satellite detail, DOP — stays the JS parser's business.
 */

/** A valid position from one RMC sentence, decimal degrees, +N/+E. */
data class NmeaFix(val lat: Double, val lon: Double)

/**
 * Parse one NMEA sentence; a position only for a valid, checksummed RMC.
 *
 * The checksum is required, not optional: these positions feed an alarm that
 * wakes a sleeping crew, and a serial glitch that corrupts a coordinate must
 * read as no fix, never as the boat moving. Proprietary sentences (talker
 * beginning "P", e.g. Garmin's $PGRMC) share the RMC suffix but not the
 * field layout, so they are excluded by name.
 */
fun parseNmeaRmc(line: String): NmeaFix? {
    val t = line.trim()
    if (!t.startsWith("$")) return null
    val star = t.lastIndexOf('*')
    if (star < 1 || star + 3 > t.length) return null
    val body = t.substring(1, star)
    val declared = t.substring(star + 1, star + 3).toIntOrNull(16) ?: return null
    var sum = 0
    for (c in body) sum = sum xor c.code
    if (sum != declared) return null
    val f = body.split(',')
    val talker = f[0]
    if (talker.length != 5 || talker[0] == 'P' || !talker.endsWith("RMC")) return null
    if (f.size < 7 || f[2] != "A") return null
    val lat = parseNmeaCoord(f[3], f[4], degreeDigits = 2) ?: return null
    val lon = parseNmeaCoord(f[5], f[6], degreeDigits = 3) ?: return null
    return NmeaFix(lat, lon)
}

/** "4216.8342","N" → 42.28057; "07105.2168","W" → −71.08695. */
private fun parseNmeaCoord(value: String, hemisphere: String, degreeDigits: Int): Double? {
    if (value.length <= degreeDigits) return null
    val degrees = value.substring(0, degreeDigits).toIntOrNull() ?: return null
    val minutes = value.substring(degreeDigits).toDoubleOrNull() ?: return null
    if (minutes >= 60.0 || minutes < 0.0) return null
    val magnitude = degrees + minutes / 60.0
    return when (hemisphere) {
        "N", "E" -> magnitude
        "S", "W" -> -magnitude
        else -> null
    }
}

/**
 * Reassemble complete lines from arbitrary serial chunks. The transport
 * delivers whatever the socket read returned; sentences are split across
 * chunks routinely. A line that grows past [maxLine] without a newline is
 * garbage (NMEA sentences are ≤82 chars) and is dropped rather than buffered
 * forever.
 */
class NmeaLineAssembler(private val maxLine: Int = 256) {
    private val buf = StringBuilder()

    /** Feed one chunk; returns the complete lines it finished. */
    fun feed(chunk: String): List<String> {
        val lines = mutableListOf<String>()
        for (c in chunk) {
            if (c == '\n') {
                if (buf.isNotEmpty()) lines.add(buf.toString().trimEnd('\r'))
                buf.setLength(0)
            } else if (buf.length < maxLine) {
                buf.append(c)
            } else {
                buf.setLength(0) // Oversized junk: resync at the next newline.
            }
        }
        return lines
    }
}

/**
 * Fastest the serial feed passes positions to the anchor detector — the
 * native GNSS subscription's cadence. External receivers commonly stream at
 * 10 Hz, and every accepted fix re-arms the GPS-loss watchdog alarm.
 */
const val ANCHOR_SERIAL_FIX_MIN_MS = 5_000L
