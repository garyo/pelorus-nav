package nav.pelorus.plugins.backgroundgps

import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Lightweight persistent diagnostic log. Appends timestamped lines to a file
 * in the app's external files dir so the trail survives WebView reloads,
 * process restarts, and the (5 MiB, OEM-capped) logcat ring buffer. Pull it
 * with:
 *
 *   adb pull /sdcard/Android/data/nav.pelorus.app/files/diag.log
 *
 * Diagnostic aid for chasing screen-off recording dropouts — cheap enough to
 * leave on. Rotates once at [MAX_BYTES] so it can't grow unbounded.
 */
object DiagLog {
    private const val FILE_NAME = "diag.log"
    private const val MAX_BYTES = 1_000_000L
    private val fmt = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)
    private val lock = Any()

    fun log(context: Context, tag: String, msg: String) {
        synchronized(lock) {
            try {
                val dir = context.getExternalFilesDir(null) ?: return
                val file = File(dir, FILE_NAME)
                if (file.length() > MAX_BYTES) {
                    val old = File(dir, "$FILE_NAME.1")
                    if (old.exists()) old.delete()
                    file.renameTo(old)
                }
                file.appendText("${fmt.format(Date())} $tag $msg\n")
            } catch (_: Exception) {
                // Diagnostics must never crash or block the app.
            }
        }
    }

    data class DiagTail(val text: String, val truncated: Boolean, val sizeBytes: Long)

    /** Read the last [maxBytes] of the log (for the in-app diagnostics export). */
    fun readTail(context: Context, maxBytes: Long): DiagTail {
        synchronized(lock) {
            val dir = context.getExternalFilesDir(null) ?: return DiagTail("", false, 0)
            val file = File(dir, FILE_NAME)
            if (!file.exists()) return DiagTail("(no diag.log)", false, 0)
            val size = file.length()
            val start = maxOf(0L, size - maxBytes)
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(start)
                val buf = ByteArray((size - start).toInt())
                raf.readFully(buf)
                var text = String(buf, Charsets.UTF_8)
                if (start > 0) text = text.substringAfter('\n', text) // drop partial first line
                return DiagTail(text, start > 0, size)
            }
        }
    }
}
