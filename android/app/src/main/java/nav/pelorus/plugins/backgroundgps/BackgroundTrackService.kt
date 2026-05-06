package nav.pelorus.plugins.backgroundgps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
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
 *   PASSIVE — screen off, recording. BALANCED_POWER_ACCURACY, slow interval
 *             (default 15s), JS bridge silenced (fixes go to SQLite only and
 *             are recovered on next visible transition), wake lock released
 *             between fixes.
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
        private const val STEADY_PASSIVE_INTERVAL_CAP_MS = 30_000L

        /** Callback for delivering live location updates to the plugin. Cleared in PASSIVE mode. */
        var locationListener: ((TrackPointRow) -> Unit)? = null

        /** Reference to the running service instance (for runtime config from plugin). */
        var instance: BackgroundTrackService? = null

        @Volatile var currentMode: String = MODE_ACTIVE
        @Volatile var activeIntervalMs: Long = 1000L
        @Volatile var passiveIntervalMs: Long = 15_000L

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

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        trackDb = TrackDatabase(this)

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
                try {
                    for (location in result.locations) {
                        val point = TrackPointRow(
                            timestamp = location.time,
                            lat = location.latitude,
                            lon = location.longitude,
                            speed = if (location.hasSpeed()) location.speed else -1f,
                            course = if (location.hasBearing()) location.bearing else -1f,
                            accuracy = if (location.hasAccuracy()) location.accuracy else -1f
                        )
                        trackDb.insertPoint(point)
                        // Bridge gating: in PASSIVE mode we drop locationListener so
                        // JS doesn't get fanned-out fixes it can't use anyway.
                        locationListener?.invoke(point)

                        // Adaptive passive sampling: feed the steadiness tracker
                        // and re-issue the LocationRequest if its recommendation
                        // flipped. Active mode never participates — visible
                        // recording stays at the user-facing rate.
                        if (currentMode == MODE_PASSIVE) {
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
            }
        }
        // Publish the instance only after fusedClient/locationCallback are
        // ready, so a plugin call landing mid-onCreate doesn't race into
        // applyMode() and skip with the "before service initialized" warning.
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
        cancelPendingPassive()
        instance = null
        if (::fusedClient.isInitialized && ::locationCallback.isInitialized) {
            fusedClient.removeLocationUpdates(locationCallback)
        }
        locationListener = null
        partialWakeLock?.let { if (it.isHeld) it.release() }
        partialWakeLock = null
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
        // active where it's unused).
        if (lastModeApplied != currentMode) {
            steadinessTracker.reset()
            lastSteadyState = false
            lastModeApplied = currentMode
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
        val priority = if (passive) Priority.PRIORITY_BALANCED_POWER_ACCURACY else Priority.PRIORITY_HIGH_ACCURACY

        // Wake-lock policy first: if entering PASSIVE, drop the continuous hold;
        // if entering ACTIVE, re-acquire it before we start delivering 1 Hz fixes.
        if (passive && holdLockContinuously) {
            partialWakeLock?.takeIf { it.isHeld }?.release()
            holdLockContinuously = false
        } else if (!passive && !holdLockContinuously) {
            partialWakeLock?.takeIf { !it.isHeld }?.acquire()
            holdLockContinuously = true
        }

        if (intervalMs == appliedIntervalMs && priority == appliedPriority) return

        fusedClient.removeLocationUpdates(locationCallback)
        val request = LocationRequest.Builder(priority, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs)
            .setWaitForAccurateLocation(false)
            .build()
        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        appliedIntervalMs = intervalMs
        appliedPriority = priority
        Log.d(TAG, "GPS mode=$currentMode interval=${intervalMs}ms priority=$priority")
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
