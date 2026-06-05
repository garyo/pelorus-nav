package nav.pelorus.plugins.backgroundgps

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Foreground GPS recording service.
 *
 * Two power modes set externally by the JS plugin:
 *   ACTIVE  — chart is visible. HIGH_ACCURACY chip, fast interval (default 1s),
 *             every fix delivered to JS via the bridge, partial wake lock held
 *             continuously.
 *   PASSIVE — screen off, recording. HIGH_ACCURACY chip, slow interval
 *             (default 15s, doubling to 30s when SteadinessTracker reports a
 *             steady course) with setWaitForAccurateLocation(true) so FLP
 *             only delivers real GPS fixes (never cell-tower / WiFi
 *             fallbacks). JS bridge silenced (fixes go to SQLite only and
 *             are recovered on next visible transition), wake lock released
 *             between fixes.
 *
 * Low-quality fixes (accuracy worse than [MAX_ACCURACY_M]) are dropped before
 * SQLite insert as a backstop against any FLP fallback that slips through.
 *
 * The mode is chosen entirely by the JS layer based on `document.visibilityState`,
 * recording state, and theme. No speed/DR-based adaptation here — that's been
 * tried and it doesn't survive sailing-speed GPS noise.
 */
class BackgroundTrackService : Service() {

    companion object {
        const val TAG = "BackgroundTrackService"
        const val CHANNEL_ID = "pelorus_track_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "nav.pelorus.STOP_TRACKING"

        const val MODE_ACTIVE = "active"
        const val MODE_PASSIVE = "passive"

        /**
         * Safety-net timeout for the per-fix wake lock in PASSIVE mode. The
         * onLocationResult handler releases the lock explicitly in a
         * finally block as soon as the work is done (sub-ms), so the
         * actual hold time is dominated by SQLite insert latency, not this
         * value. The timeout only fires if the release path is somehow
         * skipped — bug or unexpected exception during fanout.
         */
        private const val PASSIVE_WAKE_LOCK_HOLD_MS = 500L

        /**
         * When the SteadinessTracker reports the boat is on a steady course,
         * scale the passive interval up by this factor (capped). Capped well
         * below chip-power-optimal so post-turn detection latency stays
         * bounded — at most ~one slow interval before the deviation shows up.
         */
        private const val STEADY_PASSIVE_INTERVAL_MULTIPLIER = 2L
        // 20 s (was 30 s): field feedback — 30 s gaps on a steady course
        // hide whole tacks from the recorded track (see the JS maneuver
        // detector's gap-spanning fallback) and feel sluggish on wake.
        private const val STEADY_PASSIVE_INTERVAL_CAP_MS = 20_000L

        /**
         * Watchdog: if no fix has been delivered in PASSIVE for this long,
         * the chip has likely been duty-cycled off by FLP. Kick it back to
         * ACTIVE to force a warmup. Set to 6× the nominal passive interval
         * so a few missed callbacks (which happen normally) don't trip it.
         */
        private const val WATCHDOG_THRESHOLD_MS = 90_000L

        /**
         * Maximum time to stay in a watchdog-triggered ACTIVE kick before
         * giving up and returning to PASSIVE. If a kick doesn't yield a fix
         * inside this window we're in a real coverage hole and more CPU
         * isn't going to help — drop back so we don't burn battery forever.
         */
        private const val KICK_DURATION_MS = 60_000L

        private const val ACTION_WATCHDOG = "nav.pelorus.WATCHDOG_TICK"

        /** Callback for delivering live location updates to the plugin. Cleared in PASSIVE mode. */
        var locationListener: ((TrackPointRow) -> Unit)? = null

        /** Reference to the running service instance (for runtime config from plugin). */
        var instance: BackgroundTrackService? = null

        @Volatile var currentMode: String = MODE_ACTIVE
        @Volatile var activeIntervalMs: Long = 1000L
        @Volatile var passiveIntervalMs: Long = 15_000L

        /**
         * Reject fixes worse than this (meters). Real GPS is typically
         * <15 m even in marginal conditions; cell-tower / WiFi fallbacks
         * arrive at 100 m+. Mirrors MAX_ACCURACY_M in TrackRecorder.ts —
         * the JS side has the same backstop on its own ingress path.
         */
        private const val MAX_ACCURACY_M = 30f

        /** Text shown in the foreground-service notification. JS can update this via the plugin. */
        @Volatile var notificationText: String = "Navigating"
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var trackDb: TrackDatabase
    private lateinit var locationCallback: LocationCallback
    private var partialWakeLock: PowerManager.WakeLock? = null
    /** True when the wake lock is held continuously (ACTIVE). False when toggled per-fix (PASSIVE). */
    private var holdLockContinuously: Boolean = true
    /** Last applied interval/priority — applyMode skips redundant re-requests. */
    private var appliedIntervalMs: Long = -1L
    private var appliedPriority: Int = -1
    /**
     * Native main-looper handler used to schedule the deferred PASSIVE
     * transition. Lives in native land so it survives WebView suspension
     * (Chromium throttles JS setTimeout when the page is hidden).
     */
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingPassiveRunnable: Runnable? = null

    /** Steadiness detector for adaptive passive sampling. PASSIVE-only. */
    private val steadinessTracker = SteadinessTracker()
    /** Last value the tracker returned — caller compares to detect flips. */
    private var lastSteadyState = false
    /** Mode applyMode() last ran with — used to reset adaptive state on flips. */
    private var lastModeApplied: String? = null

    private var alarmManager: AlarmManager? = null
    private var watchdogPendingIntent: PendingIntent? = null
    /**
     * Receives the watchdog alarm broadcast. setAndAllowWhileIdle requires
     * a PendingIntent (no OnAlarmListener overload), so we register this
     * receiver dynamically in onCreate and route its callback to
     * [onWatchdogFired]. Meaning depends on [inKick]: a fire while not in
     * kick starts one; a fire during a kick is the give-up timer.
     */
    private val watchdogReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            onWatchdogFired()
        }
    }
    /** True while we're in a watchdog-triggered ACTIVE recovery. */
    private var inKick = false

    override fun onCreate() {
        super.onCreate()
        // Satisfy the startForegroundService() deadline as the very first
        // thing: at cold boot the main looper is saturated with WebView
        // init, and waiting for onStartCommand to post the notification
        // has blown the ~10 s window and killed the whole app
        // (ForegroundServiceDidNotStartInTimeException, BIGME 2026-06-04).
        try {
            createNotificationChannel()
            startForeground(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.e(TAG, "startForeground in onCreate failed", e)
        }
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        trackDb = TrackDatabase(this)
        alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager

        // Dynamic registration: the watchdog alarm broadcasts back to us
        // privately. NOT_EXPORTED so no other app can spoof a tick.
        ContextCompat.registerReceiver(
            this,
            watchdogReceiver,
            IntentFilter(ACTION_WATCHDOG),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        watchdogPendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            Intent(ACTION_WATCHDOG).setPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        partialWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PelorusNav::TrackRecording")
        // Default: ACTIVE → continuous wake lock.
        partialWakeLock?.acquire()
        holdLockContinuously = true

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                // PASSIVE: CPU may have been sleeping. Hold a lock for the
                // duration of this callback so SQLite writes complete, and
                // release as soon as the work is done — the timeout on
                // acquire() is a safety net if the release path is skipped,
                // not the intended hold duration.
                val acquiredPassiveLock = !holdLockContinuously
                if (acquiredPassiveLock) {
                    partialWakeLock?.acquire(PASSIVE_WAKE_LOCK_HOLD_MS)
                }
                var accepted = false
                try {
                    for (location in result.locations) {
                        // Drop fixes worse than MAX_ACCURACY_M — these are the
                        // cell-tower / WiFi fallbacks we don't want polluting
                        // the recorded track. Fixes with no accuracy field are
                        // accepted; we don't have a basis to reject them.
                        if (location.hasAccuracy() && location.accuracy > MAX_ACCURACY_M) {
                            Log.d(TAG, "Dropping low-accuracy fix: ${location.accuracy}m")
                            DiagLog.log(applicationContext, "fix", "drop acc=${location.accuracy} mode=$currentMode")
                            continue
                        }
                        accepted = true
                        val point = TrackPointRow(
                            timestamp = location.time,
                            lat = location.latitude,
                            lon = location.longitude,
                            speed = if (location.hasSpeed()) location.speed else -1f,
                            course = if (location.hasBearing()) location.bearing else -1f,
                            accuracy = if (location.hasAccuracy()) location.accuracy else -1f
                        )
                        trackDb.insertPoint(point)
                        DiagLog.log(applicationContext, "fix", "ok acc=${if (location.hasAccuracy()) location.accuracy else -1f} mode=$currentMode")
                        // Bridge gating: in PASSIVE mode we drop locationListener so
                        // JS doesn't get fanned-out fixes it can't use anyway.
                        locationListener?.invoke(point)

                        // Adaptive passive sampling: feed the steadiness tracker
                        // and re-issue the LocationRequest if its recommendation
                        // flipped. Active mode never participates — visible
                        // recording stays at the user-facing rate.
                        if (currentMode == MODE_PASSIVE && !inKick) {
                            val nowSteady =
                                steadinessTracker.onFix(location.latitude, location.longitude)
                            if (nowSteady != lastSteadyState) {
                                lastSteadyState = nowSteady
                                applyMode()
                            }
                        }
                    }
                } finally {
                    if (acquiredPassiveLock) {
                        partialWakeLock?.takeIf { it.isHeld }?.release()
                    }
                }
                // Watchdog: a fix arrived. If we were kicking, the chip is
                // alive again — end the kick and return to PASSIVE. Otherwise
                // just re-arm the deadline if we're still in PASSIVE.
                if (accepted) {
                    if (inKick) {
                        endKick("fix arrived")
                    } else if (currentMode == MODE_PASSIVE) {
                        armWatchdog(WATCHDOG_THRESHOLD_MS)
                    }
                }
            }
        }
        // Publish the instance only after fusedClient/locationCallback are
        // ready, so a plugin call landing mid-onCreate doesn't race into
        // applyMode() and skip with the "before service initialized" warning.
        instance = this
        DiagLog.log(this, "svc", "onCreate")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        DiagLog.log(this, "svc", "onStartCommand action=${intent?.action} startId=$startId mode=$currentMode")
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            createNotificationChannel()
            startForeground(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground service, stopping", e)
            stopSelf()
            return START_NOT_STICKY
        }

        applyMode()
        Log.i(TAG, "Background track service started (mode=$currentMode)")

        // START_NOT_STICKY: JS re-starts tracking when the app returns to foreground.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        DiagLog.log(this, "svc", "onDestroy")
        cancelPendingPassive()
        cancelWatchdog()
        instance = null
        if (::fusedClient.isInitialized && ::locationCallback.isInitialized) {
            fusedClient.removeLocationUpdates(locationCallback)
        }
        locationListener = null
        partialWakeLock?.let { if (it.isHeld) it.release() }
        partialWakeLock = null
        try {
            unregisterReceiver(watchdogReceiver)
        } catch (e: IllegalArgumentException) {
            // Already unregistered (onCreate failed before registration) — harmless.
        }
        watchdogPendingIntent?.cancel()
        watchdogPendingIntent = null
        alarmManager = null
        Log.i(TAG, "Background track service stopped")
    }

    /**
     * Schedule a deferred transition to PASSIVE mode after [delayMs]. The
     * service stays in its current mode (typically ACTIVE) until the grace
     * window expires; this prevents brief screen-on glances from power-cycling
     * the chip. Cancels any previously-scheduled grace.
     */
    fun schedulePassive(delayMs: Long, intervalMs: Long, plugin: BackgroundGPSPlugin?) {
        cancelPendingPassive()
        passiveIntervalMs = intervalMs
        val r = Runnable {
            pendingPassiveRunnable = null
            currentMode = MODE_PASSIVE
            // Bridge gating: drop the listener so foreground subscribers stop
            // getting per-fix wakeups. Native still writes SQLite.
            locationListener = null
            applyMode()
            Log.i(TAG, "Grace expired, switched to passive (interval=${intervalMs}ms)")
            DiagLog.log(applicationContext, "svc", "grace expired -> passive interval=${intervalMs}ms")
        }
        pendingPassiveRunnable = r
        mainHandler.postDelayed(r, delayMs)
        Log.d(TAG, "Scheduled passive transition in ${delayMs}ms")
        // plugin not actually needed here; reserved for future bridge re-install.
        @Suppress("UNUSED_PARAMETER") plugin
    }

    /** Cancel a pending PASSIVE transition (e.g. on screen-on, or stop recording). */
    fun cancelPendingPassive() {
        pendingPassiveRunnable?.let {
            mainHandler.removeCallbacks(it)
            Log.d(TAG, "Cancelled pending passive transition")
        }
        pendingPassiveRunnable = null
    }

    /**
     * Apply [currentMode] — set the location request rate/priority and the
     * wake-lock policy. Idempotent: skips re-issuing a LocationRequest when
     * the resolved (interval, priority) hasn't changed.
     */
    @Suppress("MissingPermission")
    fun applyMode() {
        if (!::fusedClient.isInitialized || !::locationCallback.isInitialized) {
            Log.w(TAG, "applyMode before service initialized, skipping")
            return
        }
        val passive = (currentMode == MODE_PASSIVE)

        // Mode transition: clear adaptive state so a stale buffer can't make
        // a wrong call the moment we re-enter passive (or stick around in
        // active where it's unused). Also clear any in-progress watchdog
        // kick — an external mode change supersedes it.
        if (lastModeApplied != currentMode) {
            steadinessTracker.reset()
            lastSteadyState = false
            lastModeApplied = currentMode
            inKick = false
        }

        val intervalMs = when {
            !passive -> activeIntervalMs
            lastSteadyState ->
                minOf(
                    passiveIntervalMs * STEADY_PASSIVE_INTERVAL_MULTIPLIER,
                    STEADY_PASSIVE_INTERVAL_CAP_MS,
                )
            else -> passiveIntervalMs
        }
        // Both modes ask for HIGH_ACCURACY — BALANCED lets FLP synthesise
        // locations from cell tower / WiFi when the GPS chip is asleep, and
        // those can be kilometres off offshore. We accept the small extra
        // chip-power cost; FLP still duty-cycles internally between fixes.
        val priority = Priority.PRIORITY_HIGH_ACCURACY

        // Wake-lock policy first: if entering PASSIVE, drop the continuous hold;
        // if entering ACTIVE, re-acquire it before we start delivering 1 Hz fixes.
        if (passive && holdLockContinuously) {
            partialWakeLock?.takeIf { it.isHeld }?.release()
            holdLockContinuously = false
        } else if (!passive && !holdLockContinuously) {
            partialWakeLock?.takeIf { !it.isHeld }?.acquire()
            holdLockContinuously = true
        }

        // Watchdog: arm only while genuinely in PASSIVE. A kick uses
        // KICK_DURATION_MS via kickToActive() — we don't want applyMode
        // to overwrite the give-up deadline. Done before the early-return
        // below so an external mode change still updates the watchdog
        // state even if the request itself doesn't need re-issuing.
        if (passive && !inKick) {
            armWatchdog(WATCHDOG_THRESHOLD_MS)
        } else if (!passive) {
            cancelWatchdog()
        }

        if (intervalMs == appliedIntervalMs && priority == appliedPriority) return

        fusedClient.removeLocationUpdates(locationCallback)
        // setWaitForAccurateLocation(true) in PASSIVE: tells FLP to wait for
        // the location engine to fuse a real fix instead of returning a
        // cached / cell-tower estimate immediately. ACTIVE keeps it false so
        // the 1 Hz stream isn't delayed waiting on every fix.
        val request = LocationRequest.Builder(priority, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs)
            .setWaitForAccurateLocation(passive)
            .build()
        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        appliedIntervalMs = intervalMs
        appliedPriority = priority
        Log.d(TAG, "GPS mode=$currentMode interval=${intervalMs}ms priority=$priority")
        DiagLog.log(applicationContext, "svc", "applyMode mode=$currentMode interval=${intervalMs}ms inKick=$inKick")
    }

    /**
     * Schedule the watchdog to fire [delayMs] from now. Uses
     * setAndAllowWhileIdle so the alarm pierces Doze without needing
     * SCHEDULE_EXACT_ALARM. Latency in deep Doze can be a couple of
     * minutes — fine for our purpose (catching multi-minute gaps).
     */
    private fun armWatchdog(delayMs: Long) {
        val am = alarmManager ?: return
        val pi = watchdogPendingIntent ?: return
        am.cancel(pi)
        am.setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + delayMs,
            pi,
        )
    }

    private fun cancelWatchdog() {
        val am = alarmManager ?: return
        val pi = watchdogPendingIntent ?: return
        am.cancel(pi)
    }

    /**
     * Watchdog fired: either no fix has arrived in WATCHDOG_THRESHOLD_MS
     * while in PASSIVE (start a kick), or KICK_DURATION_MS elapsed during
     * a kick without an accepted fix (give up).
     */
    private fun onWatchdogFired() {
        // If we've left PASSIVE while the alarm was in flight (e.g. user
        // brought the app to foreground), there's nothing to do.
        if (currentMode != MODE_PASSIVE) {
            inKick = false
            return
        }
        if (inKick) {
            endKick("kick timed out without accepted fix")
        } else {
            kickToActive()
        }
    }

    /**
     * Force the chip awake by promoting to ACTIVE behavior — continuous
     * wake lock, fast interval, HIGH_ACCURACY without the wait-for-accurate
     * gate that PASSIVE uses. currentMode stays PASSIVE so we revert
     * cleanly when an accepted fix arrives or the give-up timer fires.
     */
    @Suppress("MissingPermission")
    private fun kickToActive() {
        if (!::fusedClient.isInitialized || !::locationCallback.isInitialized) return
        Log.i(TAG, "Watchdog kick: forcing GPS chip warmup (no fix in ${WATCHDOG_THRESHOLD_MS}ms)")
        DiagLog.log(applicationContext, "svc", "watchdog kick (no fix in ${WATCHDOG_THRESHOLD_MS}ms)")
        inKick = true
        if (!holdLockContinuously) {
            partialWakeLock?.takeIf { !it.isHeld }?.acquire()
            holdLockContinuously = true
        }
        fusedClient.removeLocationUpdates(locationCallback)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, activeIntervalMs)
            .setMinUpdateIntervalMillis(activeIntervalMs)
            .setWaitForAccurateLocation(false)
            .build()
        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        appliedIntervalMs = activeIntervalMs
        appliedPriority = Priority.PRIORITY_HIGH_ACCURACY
        armWatchdog(KICK_DURATION_MS)
    }

    /**
     * End a watchdog kick — restore PASSIVE behavior via applyMode(),
     * which also re-arms the watchdog at the normal threshold.
     */
    private fun endKick(reason: String) {
        Log.i(TAG, "Watchdog kick ended: $reason")
        DiagLog.log(applicationContext, "svc", "kick end: $reason")
        inKick = false
        applyMode()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Track Recording",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when GPS track is being recorded"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, BackgroundTrackService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Pelorus Nav")
            .setContentText(notificationText)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .addAction(Notification.Action.Builder(
                null, "Stop", stopPending
            ).build())
            .build()
    }

    /** Re-emit the foreground notification with the current [notificationText]. */
    fun refreshNotification() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.notify(NOTIFICATION_ID, buildNotification())
    }
}
