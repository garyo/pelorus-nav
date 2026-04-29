package nav.pelorus.plugins.backgroundgps

import android.Manifest
import android.content.Intent
import android.os.Build
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
        // Wire up live location delivery to the WebView
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

        val intent = Intent(context, BackgroundTrackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun stopTracking(call: PluginCall) {
        BackgroundTrackService.locationListener = null
        val intent = Intent(context, BackgroundTrackService::class.java)
        context.stopService(intent)
        call.resolve()
    }

    @PluginMethod
    fun getRecordedPoints(call: PluginCall) {
        val points = trackDb?.getAllPoints() ?: emptyList()
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
    fun clearRecordedPoints(call: PluginCall) {
        trackDb?.clearAll()
        call.resolve()
    }

    @PluginMethod
    fun setGpsInterval(call: PluginCall) {
        val intervalMs = call.getLong("intervalMs", 1000L) ?: 1000L
        val adaptive = call.getBoolean("adaptive", false) ?: false
        BackgroundTrackService.desiredIntervalMs = intervalMs
        BackgroundTrackService.adaptiveEnabled = adaptive
        // If service is running, apply immediately
        BackgroundTrackService.instance?.updateInterval()
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
}
