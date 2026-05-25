package nav.pelorus.plugins.backgroundgps

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "BackgroundGPS",
    permissions = [
        Permission(
            strings = [
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ],
            alias = "location"
        ),
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = "notifications"
        )
    ]
)
class BackgroundGPSPlugin : Plugin() {

    private var trackDb: TrackDatabase? = null

    override fun load() {
        trackDb = TrackDatabase(context)
    }

    @PluginMethod
    fun startTracking(call: PluginCall) {
        // Check location permission first
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "handleLocationPermission")
            return
        }

        // Request notification permission on Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "handleNotificationPermission")
            return
        }

        doStartTracking(call)
    }

    @PermissionCallback
    private fun handleLocationPermission(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            // Now check notifications
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                getPermissionState("notifications") != PermissionState.GRANTED) {
                requestPermissionForAlias("notifications", call, "handleNotificationPermission")
            } else {
                doStartTracking(call)
            }
        } else {
            call.reject("Location permission is required for GPS tracking")
        }
    }

    @PermissionCallback
    private fun handleNotificationPermission(call: PluginCall) {
        // Start tracking even if notification permission denied — notification just won't show
        doStartTracking(call)
    }

    private fun doStartTracking(call: PluginCall) {
        // Wire up live location delivery to the WebView. The bridge listener
        // is only invoked when the service is in ACTIVE mode (the service
        // clears its own reference on PASSIVE → see applyMode()).
        installBridgeListener()
        DiagLog.log(context, "plugin", "startTracking")

        val intent = Intent(context, BackgroundTrackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    private fun installBridgeListener() {
        BackgroundTrackService.locationListener = { point ->
            val data = JSObject().apply {
                put("timestamp", point.timestamp)
                put("lat", point.lat)
                put("lon", point.lon)
                put("speed", point.speed)
                put("course", point.course)
                put("accuracy", point.accuracy)
            }
            notifyListeners("locationUpdate", data)
        }
    }

    @PluginMethod
    fun stopTracking(call: PluginCall) {
        // Trace who's stopping the service — we hit a mystery cycle of stops
        // during screen-off cruising and we want to know the JS path that
        // triggered it. Walk the stack by throwing+catching a Throwable.
        val st = Throwable("stopTracking()").stackTraceToString()
        Log.i("BackgroundGPSPlugin", "stopTracking called\n$st")
        DiagLog.log(context, "plugin", "stopTracking called\n$st")
        BackgroundTrackService.locationListener = null
        BackgroundTrackService.instance?.cancelPendingPassive()
        val intent = Intent(context, BackgroundTrackService::class.java)
        context.stopService(intent)
        call.resolve()
    }

    @PluginMethod
    fun getRecordedPoints(call: PluginCall) {
        val since = call.data.optLong("sinceTimestamp", 0L)
        val points = trackDb?.getPointsSince(since) ?: emptyList()
        val arr = JSArray()
        for (pt in points) {
            arr.put(JSObject().apply {
                put("timestamp", pt.timestamp)
                put("lat", pt.lat)
                put("lon", pt.lon)
                put("speed", pt.speed)
                put("course", pt.course)
                put("accuracy", pt.accuracy)
            })
        }
        val result = JSObject()
        result.put("points", arr)
        call.resolve(result)
    }

    @PluginMethod
    fun pruneRecordedPoints(call: PluginCall) {
        val before = call.data.optLong("beforeTimestamp", 0L)
        trackDb?.pruneBefore(before)
        call.resolve()
    }

    /** Append a line to the persistent diagnostic log from the JS layer. */
    @PluginMethod
    fun appendDiag(call: PluginCall) {
        val tag = call.getString("tag") ?: "js"
        val message = call.getString("message") ?: ""
        DiagLog.log(context, tag, message)
        call.resolve()
    }

    /**
     * Set the GPS power mode.
     *
     * mode:        "active"  → HIGH_ACCURACY, fast interval, bridge on, wake lock held.
     *              "passive" → BALANCED_POWER_ACCURACY, slow interval, bridge silenced,
     *                          wake lock toggled per-fix.
     * intervalMs:  optional. Updates the active or passive default depending on mode.
     * graceMs:     optional, only meaningful for mode="passive". When > 0, the
     *              transition to passive is deferred by this many ms via a native
     *              Handler — JS setTimeout would be throttled or suspended while
     *              the WebView is hidden, so the timer has to live here. ACTIVE
     *              cancels any pending passive transition.
     */
    @PluginMethod
    fun setPowerMode(call: PluginCall) {
        val mode = call.getString("mode") ?: BackgroundTrackService.MODE_ACTIVE
        if (mode != BackgroundTrackService.MODE_ACTIVE &&
            mode != BackgroundTrackService.MODE_PASSIVE) {
            call.reject("Unknown mode: $mode")
            return
        }
        // Capacitor's call.getLong() rejects values that arrive on the wire as
        // Integer (any JS Number that fits in 32 bits), returning null even
        // when the key is present. optLong on the underlying JSObject is
        // type-tolerant and handles Integer/Long/Double uniformly.
        val intervalMs = if (call.data.has("intervalMs")) call.data.optLong("intervalMs") else null
        val graceMs = call.data.optLong("graceMs", 0L)
        Log.i("BackgroundGPSPlugin", "setPowerMode(mode=$mode, intervalMs=$intervalMs, graceMs=$graceMs)")
        DiagLog.log(context, "plugin", "setPowerMode mode=$mode interval=$intervalMs grace=$graceMs")

        if (mode == BackgroundTrackService.MODE_ACTIVE) {
            // Active is always immediate — cancel any scheduled passive grace.
            BackgroundTrackService.instance?.cancelPendingPassive()
            if (intervalMs != null) BackgroundTrackService.activeIntervalMs = intervalMs
            BackgroundTrackService.currentMode = BackgroundTrackService.MODE_ACTIVE
            installBridgeListener()
            BackgroundTrackService.instance?.applyMode()
            call.resolve()
            return
        }

        // PASSIVE
        val effectiveInterval = intervalMs ?: BackgroundTrackService.passiveIntervalMs
        if (graceMs > 0) {
            val svc = BackgroundTrackService.instance
            if (svc != null) {
                svc.schedulePassive(graceMs, effectiveInterval, this)
            } else {
                // Service not running — apply immediately so a future start picks it up.
                BackgroundTrackService.currentMode = BackgroundTrackService.MODE_PASSIVE
                BackgroundTrackService.passiveIntervalMs = effectiveInterval
                BackgroundTrackService.locationListener = null
            }
        } else {
            BackgroundTrackService.currentMode = BackgroundTrackService.MODE_PASSIVE
            BackgroundTrackService.passiveIntervalMs = effectiveInterval
            BackgroundTrackService.locationListener = null
            BackgroundTrackService.instance?.applyMode()
        }
        call.resolve()
    }

    @PluginMethod
    fun isTracking(call: PluginCall) {
        val tracking = BackgroundTrackService.locationListener != null
        val result = JSObject()
        result.put("tracking", tracking)
        call.resolve(result)
    }

    @PluginMethod
    fun setNotificationText(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrEmpty()) {
            call.reject("text is required")
            return
        }
        BackgroundTrackService.notificationText = text
        BackgroundTrackService.instance?.refreshNotification()
        call.resolve()
    }

    @PluginMethod
    fun keepScreenOn(call: PluginCall) {
        activity.runOnUiThread {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        call.resolve()
    }

    @PluginMethod
    fun allowScreenOff(call: PluginCall) {
        activity.runOnUiThread {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        call.resolve()
    }

    /**
     * Override the activity window's screen brightness. level=-1 releases
     * the per-window override so the device system brightness applies again.
     * Values in (0, 1] dim/brighten the app's window only — the OS setting
     * is untouched.
     */
    @PluginMethod
    fun setScreenBrightness(call: PluginCall) {
        val level = call.getFloat("level") ?: run {
            call.reject("level (Float) required")
            return
        }
        activity.runOnUiThread {
            val attrs = activity.window.attributes
            attrs.screenBrightness = if (level < 0f) -1f else level.coerceIn(0.01f, 1f)
            activity.window.attributes = attrs
        }
        call.resolve()
    }

    /**
     * Return the system-wide screen-off timeout in milliseconds. Used at
     * startup to warn users whose timeout is too short for marine use —
     * e-ink devices in particular ship with vendor screensavers that yank
     * focus when this timer fires, defeating FLAG_KEEP_SCREEN_ON.
     */
    @PluginMethod
    fun getScreenOffTimeout(call: PluginCall) {
        val ms = try {
            Settings.System.getInt(
                activity.contentResolver,
                Settings.System.SCREEN_OFF_TIMEOUT,
            )
        } catch (_: Settings.SettingNotFoundException) {
            -1
        }
        val result = JSObject()
        result.put("ms", ms)
        call.resolve(result)
    }

    /**
     * Open the device's Display settings screen so the user can adjust
     * the screen-off timeout. Falls back to top-level Settings if the
     * Display intent isn't resolvable.
     */
    @PluginMethod
    fun openDisplaySettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_DISPLAY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_SETTINGS)
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(fallback)
                call.resolve()
            } catch (e2: Exception) {
                call.reject("Could not open settings: ${e2.message}")
            }
        }
    }
}
