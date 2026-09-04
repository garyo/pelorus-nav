package nav.pelorus.plugins.backgroundgps

import android.content.Context

/**
 * Durable record that the app wants GPS tracking.
 *
 * The demand itself lives in the service companion
 * ([BackgroundTrackService.trackingRequested]) and dies with the process.
 * Under way with the screen off, an OS kill — battery management, low
 * memory — used to end recording until the user next opened the app, and
 * the track simply stopped. With the demand on disk the service is
 * START_STICKY while tracking is wanted and re-adopts the demand in
 * onCreate when Android recreates it, so the buffer keeps filling for the
 * next launch to drain.
 *
 * Only an explicit stop clears it: the JS provider's stopTracking, or the
 * notification's Stop action. A process kill deliberately leaves it.
 */
object RecordingDemandStore {

    private const val PREFS = "pelorus_tracking_demand"
    private const val KEY_WANTED = "wanted"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, wanted: Boolean) {
        prefs(context).edit().putBoolean(KEY_WANTED, wanted).apply()
    }

    fun load(context: Context): Boolean =
        try {
            prefs(context).getBoolean(KEY_WANTED, false)
        } catch (_: Exception) {
            false
        }
}
