package nav.pelorus.plugins.btserial

import android.content.Context
import java.io.File

/**
 * Rolling capture of the raw Bluetooth-serial byte stream, exactly as the
 * receiver sent it — no timestamps, no filtering, no parsing. Receiver
 * forensics ("does this GPS emit an undocumented battery sentence?") need
 * the bytes the parser *didn't* recognize, which by definition no parsed
 * log contains. NMEA's own GGA/RMC time fields serve as timestamps.
 *
 * Pull with:
 *
 *   adb pull /sdcard/Android/data/nav.pelorus.app/files/btserial-raw.log
 *
 * ~600 B/s for a 10 Hz receiver; the 2 MiB cap holds roughly the last hour,
 * rotating once to `.1` like DiagLog. Cheap enough to leave always on.
 */
object BtRawLog {
    private const val FILE_NAME = "btserial-raw.log"
    private const val MAX_BYTES = 2_000_000L
    private val lock = Any()

    fun append(context: Context, chunk: String) {
        synchronized(lock) {
            try {
                val dir = context.getExternalFilesDir(null) ?: return
                val file = File(dir, FILE_NAME)
                if (file.length() > MAX_BYTES) {
                    val old = File(dir, "$FILE_NAME.1")
                    if (old.exists()) old.delete()
                    file.renameTo(old)
                }
                file.appendText(chunk)
            } catch (_: Exception) {
                // Diagnostics must never break the data path.
            }
        }
    }
}
