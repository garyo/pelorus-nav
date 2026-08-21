package nav.pelorus.plugins.backgroundgps

import android.content.Context
import android.util.Log

/**
 * Durable record of an armed anchor watch.
 *
 * Without this the watch dies with the process: [AnchorWatchParams] lived only
 * in the service companion, so an OS kill overnight ended detection until the
 * user next opened the app — silently, which is the one failure mode an anchor
 * alarm may never have. The service is START_STICKY while a watch is armed
 * (see BackgroundTrackService.onStartCommand) and re-adopts the watch from
 * here when Android recreates it.
 *
 * Only an explicit disarm [clear]s it. A service stop — the notification's
 * Stop action, a process kill, low memory — deliberately leaves it, because
 * none of those are the user standing the watch down.
 *
 * The encoding is a plain delimited string so it stays pure, unit-testable
 * logic; the store around it is a single small SharedPreferences file, read
 * once at service create.
 */
object AnchorWatchStore {

    private const val PREFS = "pelorus_anchor_watch"
    private const val KEY_PARAMS = "params"
    // Deliberately not the old "hadFix": that flag could be set by a fused
    // network position, so a watch armed by an earlier build must not carry
    // its claim of a proven GNSS receiver across the upgrade.
    private const val KEY_HAD_FIX = "hadGnssFix"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Record the armed geometry. Called on arm, anchor move and radius change. */
    fun save(context: Context, params: AnchorWatchParams) {
        prefs(context).edit().putString(KEY_PARAMS, encodeAnchorWatchParams(params)).apply()
    }

    /**
     * Remember that this watch has seen a fix from the device's own GNSS
     * receiver, so a restored watch keeps the right to raise a GPS-loss alarm
     * (and to claim screen-off cover). Written once, on the flag's false→true
     * edge — not per fix.
     */
    fun markHadFix(context: Context) {
        prefs(context).edit().putBoolean(KEY_HAD_FIX, true).apply()
    }

    /** The armed watch, or null when none was persisted (or it is unreadable). */
    fun load(context: Context): AnchorWatchParams? =
        try {
            decodeAnchorWatchParams(prefs(context).getString(KEY_PARAMS, null))
        } catch (e: Exception) {
            Log.w(BackgroundTrackService.TAG, "anchor watch restore failed", e)
            null
        }

    /** See [markHadFix]. Meaningful only alongside a loaded [AnchorWatchParams]. */
    fun loadHadFix(context: Context): Boolean =
        try {
            prefs(context).getBoolean(KEY_HAD_FIX, false)
        } catch (e: Exception) {
            false
        }

    /** The user stood the watch down: nothing may resurrect it. */
    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_PARAMS).remove(KEY_HAD_FIX).apply()
    }
}

/** Format marker: a decoder must reject anything it doesn't understand. */
private const val ANCHOR_PARAMS_FORMAT = "1"

/** Serialise an armed watch to one line. Locale-independent by construction. */
fun encodeAnchorWatchParams(params: AnchorWatchParams): String = listOf(
    ANCHOR_PARAMS_FORMAT,
    params.lat.toString(),
    params.lon.toString(),
    params.radiusM.toString(),
    params.alarmDelayMs.toString(),
    params.gpsLossAlarmMs.toString(),
    params.reAlarmMarginM.toString(),
).joinToString("|")

/**
 * Parse [encodeAnchorWatchParams]. Returns null for anything unusable — a
 * missing record, a future format, or values that would arm a watch nothing
 * could satisfy (non-finite position, non-positive radius). A watch we cannot
 * read back is better dropped than approximated.
 */
fun decodeAnchorWatchParams(encoded: String?): AnchorWatchParams? {
    val parts = encoded?.split("|") ?: return null
    if (parts.size != 7 || parts[0] != ANCHOR_PARAMS_FORMAT) return null
    val lat = parts[1].toDoubleOrNull() ?: return null
    val lon = parts[2].toDoubleOrNull() ?: return null
    val radiusM = parts[3].toDoubleOrNull() ?: return null
    val alarmDelayMs = parts[4].toLongOrNull() ?: return null
    val gpsLossAlarmMs = parts[5].toLongOrNull() ?: return null
    val reAlarmMarginM = parts[6].toDoubleOrNull() ?: return null
    if (!lat.isFinite() || !lon.isFinite() || !radiusM.isFinite() || radiusM <= 0) return null
    if (!reAlarmMarginM.isFinite() || alarmDelayMs < 0 || gpsLossAlarmMs <= 0) return null
    return AnchorWatchParams(
        lat = lat,
        lon = lon,
        radiusM = radiusM,
        alarmDelayMs = alarmDelayMs,
        gpsLossAlarmMs = gpsLossAlarmMs,
        reAlarmMarginM = reAlarmMarginM,
    )
}
