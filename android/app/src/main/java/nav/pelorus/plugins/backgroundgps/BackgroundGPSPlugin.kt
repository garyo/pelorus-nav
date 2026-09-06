package nav.pelorus.plugins.backgroundgps

import android.Manifest
import android.content.Intent
import android.media.AudioManager
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
    private var previewPlayer: android.media.MediaPlayer? = null
    /** Arming has already prompted for location permission this session. */
    private var anchorPermissionAsked = false
    /** …and for notification permission. */
    private var anchorNotifPermissionAsked = false

    override fun load() {
        trackDb = TrackDatabase(context)
        logProcessExits()
        // Installed here rather than in installBridgeListener(): the anchor
        // alarm must reach JS whatever the tracking/power state is.
        // retainUntilConsumed — the alarm fires precisely when the WebView is
        // suspended, so JS learns about it when it resumes.
        BackgroundTrackService.anchorAlarmListener = { kind, distanceM, at, reason ->
            notifyListeners(
                "anchorAlarm",
                JSObject().apply {
                    put("kind", kind)
                    put("distanceM", distanceM)
                    put("at", at)
                    // Watch-failure only: which failure to check.
                    reason?.let { put("reason", it) }
                },
                true,
            )
        }
        // A watch-failure condition ended on its own (fix arrived, keepalive
        // resumed, charger went in) — JS cannot observe any of those for this
        // kind, so it is told. Retained like the raise it undoes.
        BackgroundTrackService.anchorAlarmClearedListener = { kind ->
            notifyListeners("anchorAlarmCleared", JSObject().put("kind", kind), true)
        }
        // The notification's Silence action acknowledged natively; JS has to
        // learn or its UI keeps showing an active alarm. Notification path
        // only, so this can't echo a JS-initiated acknowledge back into a
        // loop; retained because Silence is usually tapped while the WebView
        // is suspended.
        BackgroundTrackService.anchorAcknowledgedListener = {
            notifyListeners("anchorAcknowledged", JSObject(), true)
        }
        // A WebView reload restarts JS with no alarm running, whatever the
        // previous page had asked for.
        BackgroundTrackService.jsAlarmKind = null
        BackgroundTrackService.instance?.syncAnchorAlarmSound()
    }

    /**
     * Start or stop the foreground service to match demand. Two independent
     * clients need it: the device-GPS provider (startTracking/stopTracking)
     * and an armed anchor watch, which must keep detecting whatever GPS
     * source the app itself is displaying. Neither may end the other's
     * service.
     *
     * A running service is also re-started when arming or disarming a watch:
     * the restart policy is the return value of onStartCommand, so the service
     * only becomes START_STICKY (or stops being) on a fresh start command. The
     * redundant command is cheap — startForeground and applyMode are both
     * idempotent — and both transitions happen on a user gesture with the app
     * in the foreground, where starting a foreground service is allowed.
     */
    private fun syncServiceDemand() {
        val armed = BackgroundTrackService.anchorParams != null
        val wanted = BackgroundTrackService.trackingRequested || armed
        val running = BackgroundTrackService.instance != null
        val sticky = armed || BackgroundTrackService.recordingWanted
        val stickinessStale = running && BackgroundTrackService.startedSticky != sticky
        val intent = Intent(context, BackgroundTrackService::class.java)
        when (serviceDemandAction(wanted, running, stickinessStale)) {
            ServiceDemand.START ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            ServiceDemand.STOP -> context.stopService(intent)
            ServiceDemand.NONE -> Unit
        }
    }

    /**
     * True only when PRECISE location is granted. On Android 12+ the user can
     * grant "Approximate" — the alias then reports GRANTED (coarse), but the
     * service requests HIGH_ACCURACY and its 30 m accuracy gate drops every
     * coarse fix: a running service that records nothing. Fine location is a
     * hard requirement, not a preference.
     */
    private fun hasFineLocation(): Boolean =
        androidx.core.content.ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

    @PluginMethod
    fun startTracking(call: PluginCall) {
        // Check location permission first. Re-request when only coarse is
        // granted — on Android 12+ the system dialog offers the precise
        // upgrade; if the user declines again we reject loudly below.
        if (getPermissionState("location") != PermissionState.GRANTED || !hasFineLocation()) {
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
        if (getPermissionState("location") == PermissionState.GRANTED && hasFineLocation()) {
            // Now check notifications
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                getPermissionState("notifications") != PermissionState.GRANTED) {
                requestPermissionForAlias("notifications", call, "handleNotificationPermission")
            } else {
                doStartTracking(call)
            }
        } else if (getPermissionState("location") == PermissionState.GRANTED) {
            DiagLog.log(context, "plugin", "startTracking rejected: coarse location only")
            call.reject(
                "Precise location is off — approximate location cannot record GPS tracks",
                "COARSE_LOCATION_ONLY",
            )
        } else {
            call.reject("Location permission is required for GPS tracking", "LOCATION_DENIED")
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

        BackgroundTrackService.trackingRequested = true
        syncServiceDemand()
        // Already running for an armed anchor watch: nothing started it just
        // now, so nudge it into the tracking role (notification, and the
        // location request for the current mode) itself.
        BackgroundTrackService.instance?.let {
            it.refreshNotification()
            it.applyMode()
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
        // The notification's Stop action kills the service outside JS control;
        // without this event the UI keeps believing tracking is running.
        // retainUntilConsumed: the WebView is usually hidden/suspended when
        // Stop is tapped — deliver when it resumes.
        BackgroundTrackService.stoppedListener = { reason ->
            notifyListeners(
                "trackingStopped",
                JSObject().put("reason", reason),
                true,
            )
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
        BackgroundTrackService.stoppedListener = null // JS-initiated — no event
        BackgroundTrackService.instance?.cancelPendingPassive()
        BackgroundTrackService.trackingRequested = false
        BackgroundTrackService.recordingWanted = false
        RecordingDemandStore.save(context, false)
        // Keeps running if an anchor watch is armed — the watch is a client of
        // its own, and the device GPS provider disconnecting (or the app going
        // hidden without recording) must not stand a watch down.
        syncServiceDemand()
        BackgroundTrackService.instance?.refreshNotification()
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

    /** Return the tail of the persistent diagnostic log for the diagnostics export. */
    @PluginMethod
    fun readDiag(call: PluginCall) {
        val maxBytes = call.data.optLong("maxBytes", 65_536L)
        val tail = DiagLog.readTail(context, maxBytes)
        call.resolve(JSObject().apply {
            put("text", tail.text)
            put("truncated", tail.truncated)
            put("sizeBytes", tail.sizeBytes)
        })
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
        // "Tracking" means the foreground service is running — NOT whether the
        // bridge listener is installed (that's cleared in PASSIVE mode while
        // the service keeps recording to SQLite).
        val tracking = BackgroundTrackService.instance != null
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

    /**
     * Arm or update the native anchor watch. Called on arm, anchor move and
     * radius change; the native detector keeps its hysteresis across updates.
     *
     * Detection then runs in the foreground service on every accepted fix,
     * which is the only thing still awake once the WebView is suspended — so
     * arming starts that service whether or not the app is recording a track
     * or even using the device GPS at all. That needs location permission:
     * the service is a location-type foreground service, and without the
     * grant it cannot start. Ask here rather than failing silently, since
     * arming is a user gesture and the request is exactly in context.
     */
    @PluginMethod
    fun setAnchorWatch(call: PluginCall) {
        if (anchorParamsOf(call) == null) {
            call.reject("lat, lon and a positive radiusM are required")
            return
        }
        // Once per session: setAnchorWatch is also the anchor-move and
        // radius-change call, and a declined prompt must not come back on
        // every drag of the anchor.
        if (!hasServiceLocation() && !anchorPermissionAsked) {
            anchorPermissionAsked = true
            requestPermissionForAlias("location", call, "handleAnchorLocationPermission")
            return
        }
        maybeRequestAnchorNotifications(call)
    }

    @PermissionCallback
    private fun handleAnchorLocationPermission(call: PluginCall) {
        // Arm either way: the JS watch runs while the app is awake, and a
        // rejection here would leave the two sides disagreeing about whether
        // a watch is set. Without the grant the service simply won't start —
        // the watch works while the app is up and has no screen-off cover.
        if (!hasServiceLocation()) {
            DiagLog.log(context, "plugin", "setAnchorWatch without location permission")
        }
        maybeRequestAnchorNotifications(call)
    }

    /**
     * Second link in the arming permission chain. Without POST_NOTIFICATIONS
     * the alarm still sounds and vibrates, but there is no notification —
     * so no full-screen screen-wake (what revives the frozen WebView) and
     * no Silence action. Asked once per session; a decline arms anyway.
     */
    private fun maybeRequestAnchorNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 33 &&
            getPermissionState("notifications") != PermissionState.GRANTED &&
            !anchorNotifPermissionAsked
        ) {
            anchorNotifPermissionAsked = true
            requestPermissionForAlias("notifications", call, "handleAnchorNotifPermission")
            return
        }
        armNativeAnchorWatch(call)
    }

    @PermissionCallback
    private fun handleAnchorNotifPermission(call: PluginCall) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            DiagLog.log(context, "plugin", "setAnchorWatch without notification permission")
        }
        armNativeAnchorWatch(call)
    }

    /** Whether the device is on power, from the sticky battery broadcast. */
    private fun readChargingState(): Boolean? =
        try {
            val intent = context.registerReceiver(
                null,
                android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED),
            )
            val plugged = intent?.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, -1)
            if (plugged == null || plugged < 0) null else plugged != 0
        } catch (_: Exception) {
            null
        }

    /**
     * Ask Android to exempt the app from battery optimization, once per
     * install, at first arm. Doze defers even allow-while-idle alarms by
     * many minutes on a still, unplugged, screen-off device — an anchored
     * boat at night is the textbook case — and the exemption is what
     * un-defers them. Declining leaves a standing advisory in the armed
     * panel (batteryOptimized in the status); this dialog never repeats.
     */
    private fun maybeRequestBatteryExemption() {
        val pm = context.getSystemService(android.os.PowerManager::class.java) ?: return
        if (pm.isIgnoringBatteryOptimizations(context.packageName)) return
        val prefs = context.getSharedPreferences("pelorus_anchor_prompts", 0)
        if (prefs.getBoolean("batteryExemptionAsked", false)) return
        prefs.edit().putBoolean("batteryExemptionAsked", true).apply()
        try {
            val intent = android.content.Intent(
                android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                android.net.Uri.parse("package:" + context.packageName),
            )
            (activity ?: context).let {
                if (it === context) intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                it.startActivity(intent)
            }
            DiagLog.log(context, "plugin", "battery exemption requested")
        } catch (e: Exception) {
            DiagLog.log(context, "plugin", "battery exemption request failed: ${e.message}")
        }
    }

    /**
     * The app's recording state: while a track is being recorded from the
     * device GPS the service is sticky and the demand is on disk, so an OS
     * kill under way does not end the recording (see RecordingDemandStore).
     */
    @PluginMethod
    fun setRecordingDemand(call: PluginCall) {
        val recording = call.getBoolean("recording", false) == true
        BackgroundTrackService.recordingWanted = recording
        RecordingDemandStore.save(context, recording)
        syncServiceDemand()
        call.resolve()
    }

    /**
     * The recording-interruption notice's remedy: open the exemption
     * dialog whenever asked (unlike the anchor watch's once-per-install
     * prompt — here the user tapped the button).
     */
    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        val pm = context.getSystemService(android.os.PowerManager::class.java)
        if (pm == null || pm.isIgnoringBatteryOptimizations(context.packageName)) {
            call.resolve(JSObject().put("exempt", true))
            return
        }
        try {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                android.net.Uri.parse("package:" + context.packageName),
            )
            (activity ?: context).let {
                if (it === context) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                it.startActivity(intent)
            }
            DiagLog.log(context, "plugin", "battery exemption requested (recording notice)")
            call.resolve(JSObject().put("exempt", false))
        } catch (e: Exception) {
            call.reject("battery exemption request failed: ${e.message}")
        }
    }

    /**
     * Diag-log how earlier instances of this process ended. A kill under way
     * shows in the diag log only as fixes stopping mid-cadence with no
     * onDestroy; Android's own record says whether the system (low memory,
     * the freezer, resource use), the user (swipe, force-stop) or a crash
     * did it. Each exit is logged once (deduped by timestamp), alongside
     * the battery-optimization state that governs how eager the system is.
     */
    private fun logProcessExits() {
        val pm = context.getSystemService(android.os.PowerManager::class.java)
        val optimized = pm?.isIgnoringBatteryOptimizations(context.packageName) == false
        DiagLog.log(context, "plugin", "load batteryOptimized=$optimized")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        try {
            val am = context.getSystemService(android.app.ActivityManager::class.java) ?: return
            val prefs = context.getSharedPreferences("pelorus_exit_reasons", 0)
            val lastLogged = prefs.getLong("lastTimestamp", 0L)
            var newest = lastLogged
            val fmt = java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.US)
            // Newest first from the OS; log oldest first so the file reads in order.
            for (info in am.getHistoricalProcessExitReasons(context.packageName, 0, 5).reversed()) {
                if (info.timestamp <= lastLogged) continue
                newest = maxOf(newest, info.timestamp)
                DiagLog.log(
                    context,
                    "exit",
                    "${exitReasonName(info.reason)} at=${fmt.format(java.util.Date(info.timestamp))} " +
                        "importance=${info.importance} pss=${info.pss}kB desc=${info.description}",
                )
            }
            if (newest != lastLogged) prefs.edit().putLong("lastTimestamp", newest).apply()
        } catch (e: Exception) {
            DiagLog.log(context, "plugin", "exit reasons unavailable: ${e.message}")
        }
    }

    private fun exitReasonName(reason: Int): String =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) "UNKNOWN($reason)" else when (reason) {
            android.app.ApplicationExitInfo.REASON_ANR -> "ANR"
            android.app.ApplicationExitInfo.REASON_CRASH -> "CRASH"
            android.app.ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
            android.app.ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
            android.app.ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
            android.app.ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
            android.app.ApplicationExitInfo.REASON_FREEZER -> "FREEZER"
            android.app.ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
            android.app.ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
            android.app.ApplicationExitInfo.REASON_OTHER -> "OTHER"
            android.app.ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "PACKAGE_STATE_CHANGE"
            android.app.ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "PACKAGE_UPDATED"
            android.app.ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
            android.app.ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
            android.app.ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
            android.app.ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
            else -> "UNKNOWN($reason)"
        }

    /** Precise location, the foreground service's hard requirement. */
    private fun hasServiceLocation(): Boolean =
        getPermissionState("location") == PermissionState.GRANTED && hasFineLocation()

    /** Parse the watch geometry from a call; null when it is unusable. */
    private fun anchorParamsOf(call: PluginCall): AnchorWatchParams? {
        val lat = call.getDouble("lat")
        val lon = call.getDouble("lon")
        val radiusM = call.getDouble("radiusM")
        if (lat == null || lon == null || radiusM == null || radiusM <= 0) return null
        // optDouble is type-tolerant: JS numbers land as Integer or Double
        // depending on their value, and call.getDouble() rejects the former.
        return AnchorWatchParams(
            lat = lat,
            lon = lon,
            radiusM = radiusM,
            alarmDelayMs = (call.data.optDouble("alarmDelayS", 15.0) * 1000).toLong(),
            gpsLossAlarmMs = (call.data.optDouble("gpsLossAlarmS", 120.0) * 1000).toLong(),
            reAlarmMarginM = call.data.optDouble("warnM", 8.0),
        )
    }

    /**
     * Keep the WebView's renderer runnable while a watch is armed.
     *
     * With the activity invisible Android waives the renderer's priority and
     * the cached-app freezer freezes it — measured as the JS keepalive going
     * silent ~90 s after screen-off and staying silent 18 minutes. The JS
     * watch is the detector that sees the user's chosen GPS source, so while
     * armed the renderer is pinned IMPORTANT even when not visible; disarm
     * restores the default (IMPORTANT, waived when not visible). API 26+;
     * best-effort on the UI thread.
     */
    private fun setAnchorRendererPin(pinned: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val webView = bridge?.webView ?: return
        activity?.runOnUiThread {
            try {
                webView.setRendererPriorityPolicy(
                    android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT,
                    !pinned,
                )
                DiagLog.log(context, "anchor", "renderer pin=${pinned}")
            } catch (e: Exception) {
                Log.w("BackgroundGPS", "setRendererPriorityPolicy failed", e)
            }
        }
    }

    private fun armNativeAnchorWatch(call: PluginCall) {
        val params = anchorParamsOf(call) ?: run {
            call.reject("lat, lon and a positive radiusM are required")
            return
        }
        setAnchorRendererPin(true)
        BackgroundTrackService.anchorParams = params
        // On disk before the service hears about it: from here an OS kill is
        // survivable (the service is START_STICKY while armed and re-adopts
        // the watch in onCreate).
        AnchorWatchStore.save(context, params)
        syncServiceDemand()
        // Already running (track recording, or a watch being updated): adopt
        // the new geometry. A service just started by the line above adopts it
        // from the companion in its own onCreate.
        BackgroundTrackService.instance?.applyAnchorWatch()
        DiagLog.log(
            context,
            "plugin",
            "setAnchorWatch r=${params.radiusM}m delay=${params.alarmDelayMs}ms",
        )
        call.resolve()
        maybeRequestBatteryExemption()
    }

    /**
     * Disarm the native watch and cancel any sounding alarm. The only path
     * that erases the persisted watch: everything else (a process kill, the
     * notification's Stop, a service stop) leaves it, because none of them is
     * the user standing the watch down.
     */
    @PluginMethod
    fun clearAnchorWatch(call: PluginCall) {
        setAnchorRendererPin(false)
        BackgroundTrackService.anchorParams = null
        // Standing the watch down ends its noise whatever JS last asked for.
        BackgroundTrackService.jsAlarmKind = null
        // …and its heartbeat: the next watch starts as "never beaten", so a
        // JS-less restore of *that* watch keeps full native alarm authority.
        BackgroundTrackService.resetJsKeepalive()
        AnchorWatchStore.clear(context)
        BackgroundTrackService.instance?.applyAnchorWatch()
        // Stops the service only if nothing else wants it — track recording
        // often does.
        syncServiceDemand()
        DiagLog.log(context, "plugin", "clearAnchorWatch")
        call.resolve()
    }

    /**
     * Report whether the screen-off watch is actually watching.
     *
     * The app cannot work this out for itself. On a device whose own GNSS never
     * produces a fix — a tablet with no GPS hardware, a declined permission, a
     * receiver stowed below decks — the service runs and sees nothing, and
     * stays deliberately silent about it (a watch that was never proven to
     * work has no basis for a GPS-loss alarm; alarming two minutes after every
     * screen-off would be intolerable). The result is a user who believes they
     * are covered overnight and is not, so the app asks and says so.
     */
    @PluginMethod
    fun getAnchorWatchStatus(call: PluginCall) {
        val service = BackgroundTrackService.instance
        val status = service?.anchorStatus()
        call.resolve(JSObject().apply {
            put("serviceRunning", service != null)
            put("armedNatively", status?.armed == true)
            put("hadFix", status?.hadFix == true)
            put("lastFixAgeMs", status?.lastFixAgeMs ?: -1L)
            put("armedMs", status?.armedMs ?: -1L)
            put("wakeLockHeld", status?.wakeLockHeld == true)
            // False on a device with no GNSS receiver of its own — the watch
            // has nothing to see the boat with once the WebView suspends,
            // whatever the app's own (Bluetooth) position source is doing.
            // Omitted rather than false when no watch is running here: it is
            // only known once the service has one, and an absent field reads
            // as "can't say" rather than as bad news.
            status?.let { put("gnssAvailable", it.gnssAvailable) }
            // The service's hard requirement; without it the watch runs only
            // while the app is awake, whatever else the status says.
            put("locationPermission", hasServiceLocation())
            status?.alarmKind?.let { put("alarmKind", it) }
            // Doze can defer alarms unless the user exempts the app; the
            // armed panel discloses when the exemption is missing.
            val pm = context.getSystemService(android.os.PowerManager::class.java)
            put(
                "batteryOptimized",
                pm?.isIgnoringBatteryOptimizations(context.packageName) == false,
            )
            // Overnight use should be on the charger; the armed panel
            // suggests plugging in while running on battery.
            readChargingState()?.let { put("charging", it) }
            // Read here rather than in the service: the volume is a device
            // setting, and the armed panel asks this question before the
            // service has necessarily come up.
            val audio = context.getSystemService(AudioManager::class.java)
            if (audio != null) {
                val fraction = alarmVolumeFraction(
                    audio.getStreamVolume(AudioManager.STREAM_ALARM),
                    audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                )
                if (fraction >= 0) put("alarmVolume", fraction)
                put("alarmVolumeMuted", audio.isStreamMute(AudioManager.STREAM_ALARM))
            }
        })
    }

    /** Silence a sounding native alarm without disarming (mirrors JS acknowledge). */
    @PluginMethod
    fun acknowledgeAnchorAlarm(call: PluginCall) {
        DiagLog.log(context, "anchor", "acknowledge from app")
        BackgroundTrackService.instance?.acknowledgeAnchorAlarm()
        call.resolve()
    }

    /**
     * The JS watch's alarm request and the user's mute.
     *
     * The service makes every anchor-alarm sound, whichever detector raised it
     * (see [BackgroundTrackService.syncAnchorAlarmSound]): the WebView's Web
     * Audio plays on the media stream, which is routinely turned down to
     * nothing, while this plays the app's own alarm tone on the ALARM stream.
     * So JS asks rather than sounds — and `muted` is the one thing that
     * silences both sides, because it is the user's explicit choice.
     *
     * `kind` ([ANCHOR_ALARM_DRAG] / [ANCHOR_ALARM_GPS_LOSS]) picks the tone, so
     * a JS-detected drag sounds like a drag. An older page that sends none is
     * taken to mean the drag siren: it is the more urgent of the two, and the
     * wrong-but-alarming sound beats the reassuring one.
     *
     * Answers with whether a service was there to take it: without one — a
     * watch armed while location permission is denied cannot start a
     * foreground service — nothing native can make noise, and JS has to sound
     * for itself rather than fall silent.
     */
    @PluginMethod
    fun setAnchorAlarmSound(call: PluginCall) {
        // Logged so a dual-path test can tell who asked for noise: the JS
        // watch (this call) or the service's own detector (the ALARM line).
        DiagLog.log(
            context,
            "anchor",
            "js sound request sounding=${call.getBoolean("sounding", false)} " +
                "kind=${call.getString("kind") ?: "-"} " +
                "muted=${call.getBoolean("muted", false)}",
        )
        val sounding = call.getBoolean("sounding") ?: false
        BackgroundTrackService.jsAlarmKind =
            if (sounding) call.getString("kind") ?: ANCHOR_ALARM_DRAG else null
        BackgroundTrackService.anchorAlarmMuted = call.getBoolean("muted") ?: false
        AnchorWatchStore.saveMuted(context, BackgroundTrackService.anchorAlarmMuted)
        val service = BackgroundTrackService.instance
        service?.syncAnchorAlarmSound()
        call.resolve(JSObject().put("serviceRunning", service != null))
    }

    /**
     * The skipper's chosen alarm volume (0–1 of the ALARM stream's maximum).
     * Absolute: while an alarm sounds the stream is set to this level in
     * either direction — the slider, not the rocker, decides how loud a
     * 3 a.m. alarm is. Persisted with the watch so a process restart keeps
     * it, and applied live to an already-sounding alarm.
     */
    @PluginMethod
    fun setAnchorAlarmVolume(call: PluginCall) {
        val volume = call.getDouble("volume")
        if (volume == null || volume.isNaN()) {
            call.reject("volume (0-1) is required")
            return
        }
        val clamped = volume.coerceIn(0.0, 1.0)
        BackgroundTrackService.anchorAlarmVolume = clamped
        AnchorWatchStore.saveAlarmVolume(context, clamped)
        BackgroundTrackService.instance?.applyAnchorAlarmVolume()
        call.resolve()
    }

    /**
     * Play ~one beat of the drag tone at the chosen volume, on the ALARM
     * stream — the exact sound and loudness a real alarm would have, so the
     * slider can be calibrated at the dock without waking the marina. Works
     * without the service (the slider lives on the setup card, pre-arm).
     * A real sounding alarm owns the stream and is never interrupted.
     */
    @PluginMethod
    fun previewAnchorAlarm(call: PluginCall) {
        if (BackgroundTrackService.instance?.isAnchorAlarmSounding() == true) {
            call.resolve()
            return
        }
        try {
            previewPlayer?.release()
        } catch (_: Exception) {}
        previewPlayer = null
        val am = context.getSystemService(AudioManager::class.java)
        val attrs = android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val player = android.media.MediaPlayer.create(
            context,
            nav.pelorus.app.R.raw.anchor_alarm_drag,
            attrs,
            am?.generateAudioSessionId() ?: 0,
        )
        if (player == null) {
            call.reject("preview player unavailable")
            return
        }
        var prior = -1
        var target = -1
        if (am != null) {
            val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            val current = am.getStreamVolume(AudioManager.STREAM_ALARM)
            target = anchorAlarmTargetIndex(
                current, max, ANCHOR_ALARM_DRAG, BackgroundTrackService.anchorAlarmVolume,
            )
            if (target >= 0) {
                try {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, target, 0)
                    prior = current
                } catch (_: SecurityException) {
                    // DND refuses the change; preview at the current level.
                }
            }
        }
        previewPlayer = player
        player.setOnCompletionListener {
            try {
                if (prior >= 0 && am != null &&
                    am.getStreamVolume(AudioManager.STREAM_ALARM) == target
                ) {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, prior, 0)
                }
            } catch (_: SecurityException) {}
            it.release()
            if (previewPlayer === it) previewPlayer = null
        }
        player.start()
        call.resolve()
    }

    /**
     * The app's GPS — often an external Bluetooth receiver the service never
     * sees — delivered a fix. Holds off the native GPS-loss alarm while the
     * WebView is awake, without touching drag detection.
     */
    @PluginMethod
    fun noteExternalFix(call: PluginCall) {
        BackgroundTrackService.instance?.onExternalAnchorFix()
        call.resolve()
    }

    /**
     * The armed JS watch's liveness heartbeat, every 10 s while the WebView
     * actually runs. `sinceLastMs` is JS's own measured elapsed since its
     * previous beat, so native can tell throttling (beats arrive late) from
     * freezing (no beats). While the beats are fresh the JS watch is the
     * authoritative detector and the native one detects silently; once they
     * go stale ([ANCHOR_KEEPALIVE_STALE_MS]) — or if they never started —
     * the native detector announces its alarms itself. Deliberately silent
     * per-beat: the diag log carries transitions only.
     */
    @PluginMethod
    fun anchorKeepalive(call: PluginCall) {
        BackgroundTrackService.noteJsKeepalive(context, call.data.optLong("sinceLastMs", 0L))
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
