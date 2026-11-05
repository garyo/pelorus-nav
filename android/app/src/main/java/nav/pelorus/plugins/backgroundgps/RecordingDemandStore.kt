package nav.pelorus.plugins.backgroundgps

import android.content.Context

/**
 * Durable record that a track is being recorded from the device GPS.
 *
 * The service companion's state dies with the process, and a recording
 * must not: with this on disk the service is START_STICKY and re-adopts
 * the demand in onCreate when Android recreates it after an OS kill, so
 * the buffer keeps filling for the next launch to drain. It is written
 * from the app's recording state (setRecordingDemand), not from the
 * device-GPS provider merely connecting — a chart being viewed is not a
 * recording, and must not leave a GPS service running with no consumer.
 *
 * Only an explicit end clears it: the app stopping the recording or the
 * device-GPS provider, or the notification's Stop action. A process kill
 * deliberately leaves it.
 */
object RecordingDemandStore {

    private const val PREFS = "pelorus_tracking_demand"
    private const val KEY_WANTED = "wanted"
    private const val KEY_FROM_DEVICE = "fromDevice"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** `fromDevice`: the recording uses the device's own GPS (not, say, a
     *  Bluetooth GPS), so the device's location must keep running for it. */
    fun save(context: Context, wanted: Boolean, fromDevice: Boolean = true) {
        prefs(context).edit()
            .putBoolean(KEY_WANTED, wanted)
            .putBoolean(KEY_FROM_DEVICE, fromDevice)
            .apply()
    }

    fun loadFromDevice(context: Context): Boolean =
        try {
            prefs(context).getBoolean(KEY_FROM_DEVICE, true)
        } catch (_: Exception) {
            true
        }

    fun load(context: Context): Boolean =
        try {
            prefs(context).getBoolean(KEY_WANTED, false)
        } catch (_: Exception) {
            false
        }
}
