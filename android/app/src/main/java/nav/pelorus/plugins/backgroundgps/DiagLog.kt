package nav.pelorus.plugins.backgroundgps

import android.content.Context
import java.io.File
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
}
