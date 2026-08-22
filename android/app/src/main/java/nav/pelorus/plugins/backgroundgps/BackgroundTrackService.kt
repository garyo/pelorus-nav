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
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
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
 *
 * The service also carries the screen-off anchor watch ([AnchorWatchDetector]),
 * fed by its own [android.location.LocationManager.GPS_PROVIDER] subscription
 * rather than by the fused stream above — see [startAnchorGnssUpdates] for why
 * a fused position is unusable for drag detection. A separate Doze-piercing
 * alarm catches sustained GNSS silence. Alarms use their own IMPORTANCE_HIGH
 * channel with service-owned looping alarm-stream audio, because the tracking
 * channel is deliberately silent — and that audio is the *only* anchor-alarm
 * sound, in every app state, because Web Audio in the WebView plays on the
 * media stream (see [syncAnchorAlarmSound]). While a watch is armed the
 * service holds its own continuous wake lock and floors both location cadences at
 * [ANCHOR_PASSIVE_INTERVAL_MS] — see [acquireAnchorWakeLock].
 *
 * An armed watch is an independent reason for the service to exist: the app's
 * displayed fixes may come from an external Bluetooth receiver over the
 * WebView bridge, which is suspended exactly when the watch matters, so the
 * device's GNSS chip stands in as the watch's own position source. A device
 * with no GNSS gets no screen-off cover at all, and the app says so rather
 * than pretending (see [anchorStatus]).
 *
 * An armed watch also outlives the process: it is persisted by
 * [AnchorWatchStore], re-adopted in [onCreate], and while one is armed
 * onStartCommand returns START_STICKY so Android recreates the service after
 * an out-of-memory kill.
 */
class BackgroundTrackService : Service() {

    companion object {
        const val TAG = "BackgroundTrackService"
        const val CHANNEL_ID = "pelorus_track_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "nav.pelorus.STOP_TRACKING"

        /**
         * Anchor alarm channel — separate from [CHANNEL_ID], which is
         * IMPORTANCE_LOW so hours of track recording stay silent. This one
         * has to wake a sleeping crew.
         */
        const val ANCHOR_CHANNEL_ID = "pelorus_anchor_alarm_channel"
        const val ANCHOR_NOTIFICATION_ID = 2
        const val ACTION_ANCHOR_SILENCE = "nav.pelorus.ANCHOR_SILENCE"

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

        /**
         * Location interval ceiling while an anchor watch is armed.
         *
         * The passive 15–20 s cadence is tuned for track recording, where a
         * late fix costs a little track detail. For an armed watch the same
         * lateness lands on top of the excursion delay as pure alarm latency:
         * at 15 s a drag needs two fixes ~30 s apart before the 15 s default
         * delay can even complete. 5 s keeps detection inside that delay. The
         * watch already holds the CPU awake (see [acquireAnchorWakeLock]), so
         * the extra cost is GPS chip duty cycle alone — and an armed anchor
         * alarm is a safety feature the user opted into, not a battery saver.
         */
        private const val ANCHOR_PASSIVE_INTERVAL_MS = 5_000L

        private const val ACTION_WATCHDOG = "nav.pelorus.WATCHDOG_TICK"
        private const val ACTION_ANCHOR_WATCHDOG = "nav.pelorus.ANCHOR_WATCHDOG_TICK"

        /**
         * Floor for the anchor GPS-loss deadline re-arm. setAndAllowWhileIdle
         * fires late in Doze, never early, so a rescheduled remainder is only
         * ever a few ms — clamp it so we can't spin.
         */
        private const val ANCHOR_WATCHDOG_MIN_DELAY_MS = 5_000L

        /** Vibration cadence while the anchor alarm sounds: on 600 / off 400. */
        private val ANCHOR_VIBRATE_PATTERN = longArrayOf(0L, 600L, 400L)

        /** Callback for delivering live location updates to the plugin. Cleared in PASSIVE mode. */
        var locationListener: ((TrackPointRow) -> Unit)? = null

        /**
         * Callback for reporting a service stop that JS did NOT initiate
         * (the notification's Stop action). The plugin clears this on its own
         * stopTracking() so a user-initiated stop emits nothing.
         */
        var stoppedListener: ((reason: String) -> Unit)? = null

        /**
         * Callback for reporting a native anchor alarm to the plugin, which
         * forwards it to JS as a retained event. Fires whether or not the app
         * is in the foreground — JS needs to reconcile either way.
         */
        var anchorAlarmListener: ((kind: String, distanceM: Double, at: Long) -> Unit)? = null

        /** Reference to the running service instance (for runtime config from plugin). */
        var instance: BackgroundTrackService? = null

        /**
         * The armed anchor watch, or null. Lives in the companion so it
         * survives a service stop/start within the process, exactly like
         * [currentMode]; JS re-pushes it after a process restart.
         */
        @Volatile var anchorParams: AnchorWatchParams? = null

        /**
         * True while the JS device-GPS provider wants live tracking
         * (startTracking..stopTracking). Independent of [anchorParams]: an
         * armed anchor watch keeps the service running by itself so that
         * screen-off detection works whatever GPS source the app displays,
         * and while it is the only client the service records nothing — its
         * fixes exist solely to feed the detector.
         */
        @Volatile var trackingRequested: Boolean = false

        /**
         * The JS watch is asking for alarm noise, set by the plugin's
         * setAnchorAlarmSound(). All anchor-alarm sound is made here, on the
         * ALARM stream, whichever side detected the alarm: the WebView's own
         * Web Audio lands on the MEDIA stream, which is routinely near-silent.
         */
        @Volatile var jsAlarmRequested: Boolean = false

        /**
         * The user muted this watch's alarms. Held here rather than only in JS
         * because the alarm that matters most fires while the WebView is
         * suspended, and mute has to reach it.
         */
        @Volatile var anchorAlarmMuted: Boolean = false

        /**
         * What the last onStartCommand returned. The plugin re-starts a
         * running service when this no longer matches whether a watch is
         * armed — see [startResult] and syncServiceDemand.
         */
        @Volatile var startedSticky: Boolean = false

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
    /**
     * Second, independent lock held for exactly as long as a watch is armed.
     * Separate instance (and tag) from [partialWakeLock] so the ACTIVE /
     * per-fix policy above can't release the anchor watch's hold, and so
     * neither can double-acquire the other's.
     */
    private var anchorWakeLock: PowerManager.WakeLock? = null
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
    private val watchdogBackoff = WatchdogBackoff()
    /** Last value the tracker returned — caller compares to detect flips. */
    private var lastSteadyState = false
    /** Mode applyMode() last ran with — used to reset adaptive state on flips. */
    private var lastModeApplied: String? = null

    /**
     * Live anchor-watch state machine; non-null exactly while armed. Volatile
     * because the plugin thread arms it while the main looper's location
     * callback reads it.
     */
    @Volatile private var anchorDetector: AnchorWatchDetector? = null
    /**
     * Elapsed-realtime at which the current detector was created. Reported as
     * `armedMs` so the app can tell "still acquiring" from "this device's GPS
     * is never going to produce a fix" — see [anchorStatus].
     */
    @Volatile private var anchorDetectorSinceElapsedMs: Long = 0L
    private var anchorAlarmPlayer: MediaPlayer? = null
    /** The alarm sound (ringtone loop + vibration) is running. */
    private var anchorAlarmSounding = false
    /**
     * ALARM-stream index before [raiseAlarmVolume] lifted it, and the index it
     * lifted it to; both -1 when nothing was raised. The second one is what
     * makes the restore safe: a level the user changed while the alarm was
     * sounding is theirs to keep.
     */
    private var anchorAlarmPriorVolume = -1
    private var anchorAlarmRaisedVolume = -1
    private var anchorWatchdogPendingIntent: PendingIntent? = null

    /** Platform LocationManager — the anchor watch's GNSS-only feed. */
    private var locationManager: LocationManager? = null

    /**
     * Subscribed to [LocationManager.GPS_PROVIDER] exactly while a watch is
     * armed; see [startAnchorGnssUpdates] for why the watch does not read the
     * fused stream the rest of this service runs on.
     */
    private var anchorGnssListener: LocationListener? = null

    /**
     * This device has a GNSS receiver the watch could subscribe to. False on a
     * tablet with no GPS hardware, which is the case the app has to disclose
     * rather than pretend to watch.
     */
    @Volatile private var anchorGnssAvailable: Boolean = false

    private var alarmManager: AlarmManager? = null
    private var watchdogPendingIntent: PendingIntent? = null
    /**
     * Receives both Doze-piercing alarm broadcasts. setAndAllowWhileIdle
     * requires a PendingIntent (no OnAlarmListener overload), so we register
     * this receiver dynamically in onCreate and dispatch on the action.
     *
     * [ACTION_WATCHDOG] is the GPS-chip watchdog, whose meaning depends on
     * [inKick]: a fire while not in kick starts one; a fire during a kick is
     * the give-up timer. [ACTION_ANCHOR_WATCHDOG] is the anchor watch's
     * GPS-loss deadline.
     */
    private val watchdogReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_ANCHOR_WATCHDOG -> onAnchorWatchdogFired()
                else -> onWatchdogFired()
            }
        }
    }
    /** True while we're in a watchdog-triggered ACTIVE recovery. */
    private var inKick = false

    /** True when this instance adopted its watch from disk, not from JS. */
    private var anchorRestoredFromStore = false

    override fun onCreate() {
        super.onCreate()
        // Recover an armed watch before anything else: after an OS kill the
        // companion is empty, and both the notification built below and the
        // START_STICKY decision in onStartCommand have to know that a watch is
        // armed. One small SharedPreferences read, so it fits inside the
        // startForeground deadline guarded below.
        if (anchorParams == null) {
            AnchorWatchStore.load(this)?.let {
                anchorParams = it
                anchorRestoredFromStore = true
                Log.i(TAG, "Restored armed anchor watch after process restart")
            }
        }
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
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager

        // Dynamic registration: the watchdog alarm broadcasts back to us
        // privately. NOT_EXPORTED so no other app can spoof a tick.
        ContextCompat.registerReceiver(
            this,
            watchdogReceiver,
            IntentFilter(ACTION_WATCHDOG).apply { addAction(ACTION_ANCHOR_WATCHDOG) },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        watchdogPendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            Intent(ACTION_WATCHDOG).setPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        anchorWatchdogPendingIntent = PendingIntent.getBroadcast(
            this,
            2,
            Intent(ACTION_ANCHOR_WATCHDOG).setPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        partialWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PelorusNav::TrackRecording")
        // Default: ACTIVE → continuous wake lock.
        partialWakeLock?.acquire()
        holdLockContinuously = true
        // Reference counting off: acquire/release then mean "make sure it is
        // held / not held", which is what the arm/disarm paths below want.
        anchorWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PelorusNav::AnchorWatch")
            .apply { setReferenceCounted(false) }

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
                        // Deliberately NOT fed to the anchor watch: this is the
                        // fused stream, and FLP will happily synthesise a
                        // position from WiFi or cell towers when the chip has
                        // nothing. Such a fix has no useful relationship to the
                        // boat — on a tablet with no GNSS at all it is the only
                        // thing that ever arrives — and it alarmed at zero
                        // distance. The watch reads GNSS directly instead; see
                        // [startAnchorGnssUpdates].
                        //
                        // Anchor-only service (no tracking client): the fix has
                        // nothing left to do. Recording it would fill the buffer
                        // with device-chip fixes for a user whose position
                        // source is an external receiver, to be replayed as
                        // "live" the next time the device GPS provider connects.
                        if (!trackingRequested) continue
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
                    watchdogBackoff.reset()
                    if (inKick) {
                        endKick("fix arrived")
                    } else if (currentMode == MODE_PASSIVE) {
                        armWatchdog(watchdogBackoff.nextDelayMs())
                    }
                }
            }
        }
        // Publish the instance only after fusedClient/locationCallback are
        // ready, so a plugin call landing mid-onCreate doesn't race into
        // applyMode() and skip with the "before service initialized" warning.
        instance = this
        // A watch armed before the service existed (or before a restart)
        // lives in the companion — pick it up now.
        applyAnchorWatch()
        if (anchorRestoredFromStore) {
            DiagLog.log(this, "anchor", "restored from store after process restart")
        }
        DiagLog.log(this, "svc", "onCreate")
    }

    /**
     * Restart policy, re-asserted on every start command (the plugin restarts
     * the service on every demand change so this value can never go stale).
     *
     * START_STICKY while a watch is armed: an overnight anchor alarm that
     * quietly ends with an out-of-memory kill is worse than useless, and
     * Android recreating the service is the only way back — [onCreate]
     * re-adopts the watch from [AnchorWatchStore].
     *
     * START_STICKY rather than START_REDELIVER_INTENT because the start intent
     * carries no payload to redeliver (the watch is on disk, the mode is in the
     * companion), and the *last* intent may well have been the notification's
     * Stop or the alarm's Silence — actions that must not be replayed against a
     * freshly restored watch.
     *
     * With no watch armed nothing changes: track recording is re-started by JS
     * when the app returns to the foreground, so a sticky restart would only
     * resurrect a service with no client.
     */
    private fun startResult(): Int {
        val sticky = anchorParams != null
        startedSticky = sticky
        return if (sticky) START_STICKY else START_NOT_STICKY
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        DiagLog.log(this, "svc", "onStartCommand action=${intent?.action} startId=$startId mode=$currentMode")
        if (intent?.action == ACTION_STOP) {
            // Notification Stop: the user ended tracking outside JS. Tell the
            // WebView (so the UI stops claiming tracking is live) and drop the
            // bridge listener — a stale one would report isTracking-ish state
            // and leak per-fix callbacks if the service were ever restarted.
            DiagLog.log(this, "svc", "stopped via notification action")
            trackingRequested = false
            locationListener = null
            stoppedListener?.invoke("notification")
            // Stop ends tracking, not the anchor watch: standing a watch down
            // requires opening the app, exactly like the alarm's Silence.
            if (anchorParams != null) {
                refreshNotification()
                applyMode()
                return startResult()
            }
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == ACTION_ANCHOR_SILENCE) {
            // The alarm notification's Silence action — same semantics as the
            // app's acknowledge: quiet now, still watching. There is
            // deliberately no Disarm action; standing the watch down requires
            // opening the app.
            acknowledgeAnchorAlarm()
            return startResult()
        }

        try {
            createNotificationChannel()
            startForeground(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground service, stopping", e)
            locationListener = null
            stoppedListener?.invoke("foreground-start-failed")
            stopSelf()
            return START_NOT_STICKY
        }

        applyMode()
        Log.i(TAG, "Background track service started (mode=$currentMode)")

        return startResult()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        DiagLog.log(this, "svc", "onDestroy")
        cancelPendingPassive()
        cancelWatchdog()
        cancelAnchorWatchdog()
        // Silence, but keep [anchorParams]: the watch itself is still armed
        // as far as JS is concerned, and a service restart re-arms detection.
        stopAnchorAlarmSound()
        stopAnchorGnssUpdates()
        anchorDetector = null
        instance = null
        if (::fusedClient.isInitialized && ::locationCallback.isInitialized) {
            fusedClient.removeLocationUpdates(locationCallback)
        }
        locationListener = null
        partialWakeLock?.let { if (it.isHeld) it.release() }
        partialWakeLock = null
        // The watch stays armed in [anchorParams], but nothing is watching
        // while the service is down — holding the CPU awake for it would be a
        // pure battery leak. onCreate re-acquires when it re-adopts the watch.
        releaseAnchorWakeLock()
        anchorWakeLock = null
        try {
            unregisterReceiver(watchdogReceiver)
        } catch (e: IllegalArgumentException) {
            // Already unregistered (onCreate failed before registration) — harmless.
        }
        watchdogPendingIntent?.cancel()
        watchdogPendingIntent = null
        anchorWatchdogPendingIntent?.cancel()
        anchorWatchdogPendingIntent = null
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
     *
     * Main-thread confined: callers can be on the plugin executor (setPowerMode)
     * or the main looper (location callback, watchdog, onStartCommand), and the
     * mode fields this reads/writes (appliedIntervalMs, lastSteadyState, inKick,
     * holdLockContinuously) are plain fields — concurrent runs could double-issue
     * or skip a LocationRequest or leave the wake lock in the wrong policy. Off
     * the main thread the work is posted; on it, it runs synchronously so
     * existing callback-path ordering is unchanged.
     */
    fun applyMode() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            applyModeOnMain()
        } else {
            mainHandler.post { applyModeOnMain() }
        }
    }

    @Suppress("MissingPermission")
    private fun applyModeOnMain() {
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
            watchdogBackoff.reset()
        }

        val intervalMs = when {
            !passive -> activeIntervalMs
            // An armed watch overrides the recording cadence, including the
            // steady-course stretch below: a boat at anchor reads as steady
            // precisely when it is dragging slowly. Only while something
            // consumes these fixes, though — anchor detection runs off its own
            // GPS_PROVIDER subscription, so on an anchor-only service every
            // fused fix is discarded and the floor would burn the chip for
            // nothing.
            anchorParams != null && trackingRequested ->
                minOf(passiveIntervalMs, ANCHOR_PASSIVE_INTERVAL_MS)
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
            armWatchdog(watchdogBackoff.nextDelayMs())
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
        DiagLog.log(applicationContext, "svc", "watchdog armed ${delayMs}ms")
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
            // Fruitless kick: stretch the next watchdog delay (90 s → 15 min
            // cap) so an unusable-GPS situation doesn't burn a 40% duty
            // cycle forever. Any accepted fix resets the schedule.
            watchdogBackoff.onKickFruitless()
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

    // --- Anchor watch ---------------------------------------------------

    /**
     * Adopt [anchorParams]: create the detector on arm, update it in place on
     * an anchor move or radius change (so hysteresis and the "has ever had a
     * fix" flag survive), tear everything down on disarm.
     */
    fun applyAnchorWatch() {
        val params = anchorParams
        if (params == null) {
            anchorDetector = null
            anchorRestoredFromStore = false
            cancelAnchorWatchdog()
            stopAnchorGnssUpdates()
            clearAnchorAlarm()
            releaseAnchorWakeLock()
            refreshNotification()
            applyMode()
            return
        }
        acquireAnchorWakeLock()
        startAnchorGnssUpdates()
        val now = SystemClock.elapsedRealtime()
        val existing = anchorDetector
        if (existing == null) {
            // A watch adopted from disk was already proven to work if it had
            // seen a fix — see AnchorWatchDetector.restored for what survives.
            anchorDetector = AnchorWatchDetector.restored(
                params,
                hadFix = anchorRestoredFromStore && AnchorWatchStore.loadHadFix(this),
                nowElapsedMs = now,
            )
            anchorDetectorSinceElapsedMs = now
        } else {
            handleAnchorTransition(existing.updateParams(params, now))
        }
        armAnchorWatchdog(params.gpsLossAlarmMs)
        refreshNotification()
        // Arming changes the location cadence (ANCHOR_PASSIVE_INTERVAL_MS) and,
        // for an anchor-only service, is what starts location updates at all.
        applyMode()
        DiagLog.log(
            applicationContext,
            "anchor",
            "armed r=${params.radiusM}m delay=${params.alarmDelayMs}ms loss=${params.gpsLossAlarmMs}ms",
        )
    }

    /**
     * Hold the CPU awake for as long as a watch is armed.
     *
     * The per-fix and ACTIVE-mode locks above are enough for track recording,
     * where a missed hour is a gap in a line. They are not enough for an
     * anchor watch: in the deepest OEM sleep states — a BOOX with its magnetic
     * cover closed, as opposed to a press of the power button — location
     * delivery and the alarm timers simply stop between wakeups, and the watch
     * silently stops watching. A continuous partial wake lock is the standard
     * mechanism anchor-alarm apps use, and the trade is one the user made
     * deliberately when they armed a safety alarm: an overnight watch that
     * costs battery beats one that misses a drag.
     */
    private fun acquireAnchorWakeLock() {
        val lock = anchorWakeLock ?: return
        if (lock.isHeld) return
        lock.acquire()
        DiagLog.log(applicationContext, "anchor", "wake lock acquired")
    }

    /** Released on every path out of "armed": disarm, and service destroy. */
    private fun releaseAnchorWakeLock() {
        val lock = anchorWakeLock ?: return
        if (!lock.isHeld) return
        lock.release()
        DiagLog.log(applicationContext, "anchor", "wake lock released")
    }

    /**
     * Subscribe the anchor watch to this device's own GNSS receiver, and to
     * nothing else.
     *
     * The rest of the service runs on FusedLocationProvider, which is the
     * right thing for track recording: it fuses, it duty-cycles, and when the
     * chip has nothing it falls back to WiFi and cell-tower trilateration. For
     * an anchor watch that fallback is poison. A network position is derived
     * from whichever access points are in range, so it sits tens to hundreds
     * of metres from the boat and hops as the neighbours' routers come and go
     * — indistinguishable from a drag, and on a tablet with no GNSS hardware
     * at all (the e-ink case) it is the *only* thing FLP ever delivers. That
     * is what alarmed at zero distance seconds after arming, and worse, made
     * the app report the watch as covered.
     *
     * [LocationManager.GPS_PROVIDER] settles it by construction rather than by
     * heuristic: every fix it delivers came from the satellite engine. The
     * fused stream cannot be filtered as reliably — its Location carries
     * provider "fused", `setWaitForAccurateLocation(true)` is a hint rather
     * than a guarantee, and the satellite count in `extras` is not populated by
     * every OEM's implementation. A GnssStatus.Callback would answer "are
     * satellites being used right now", but it still cannot tell which engine
     * produced a given fused fix; subscribing to the GNSS provider makes the
     * question unnecessary.
     *
     * A device with no GNSS throws (or has no such provider) — recorded in
     * [anchorGnssAvailable] so the app can say so plainly instead of claiming
     * a watch it does not have.
     */
    @Suppress("MissingPermission")
    private fun startAnchorGnssUpdates() {
        if (anchorGnssListener != null) return
        val lm = locationManager
        val hasHardware =
            packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)
        if (lm == null || !hasHardware || LocationManager.GPS_PROVIDER !in lm.allProviders) {
            anchorGnssAvailable = false
            Log.w(TAG, "Anchor watch: no GNSS provider on this device")
            DiagLog.log(applicationContext, "anchor", "no GNSS provider — no screen-off cover")
            return
        }
        // Written out rather than as a lambda: the other three methods only
        // got default implementations in API 30, and on an older device the
        // framework calls them on an interface that still declares them
        // abstract.
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) = onAnchorFix(location)

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
            }

            override fun onProviderEnabled(provider: String) {}

            override fun onProviderDisabled(provider: String) {}
        }
        try {
            lm.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                ANCHOR_PASSIVE_INTERVAL_MS,
                0f,
                listener,
                Looper.getMainLooper(),
            )
        } catch (e: Exception) {
            // Permission revoked mid-watch, or an OEM that lists the provider
            // and refuses it. Either way there is no cover to claim.
            anchorGnssAvailable = false
            Log.w(TAG, "Anchor watch: GNSS updates unavailable", e)
            DiagLog.log(applicationContext, "anchor", "GNSS updates unavailable: ${e.message}")
            return
        }
        anchorGnssListener = listener
        anchorGnssAvailable = true
        DiagLog.log(applicationContext, "anchor", "GNSS updates started")
    }

    private fun stopAnchorGnssUpdates() {
        val listener = anchorGnssListener ?: return
        anchorGnssListener = null
        try {
            locationManager?.removeUpdates(listener)
        } catch (e: Exception) {
            Log.w(TAG, "Anchor watch: removing GNSS updates failed", e)
        }
        DiagLog.log(applicationContext, "anchor", "GNSS updates stopped")
    }

    /**
     * Silence a sounding alarm; the watch keeps running. Silences the JS
     * side's request too: this is the notification's Silence action as much as
     * the app's own acknowledge, and the user who taps it means "quiet", not
     * "quiet unless the WebView still wants noise".
     */
    fun acknowledgeAnchorAlarm() {
        val silenced = anchorDetector?.acknowledge() ?: false
        jsAlarmRequested = false
        clearAnchorAlarm()
        if (silenced) DiagLog.log(applicationContext, "anchor", "acknowledged")
    }

    /**
     * Start or stop the alarm sound to match what is wanted right now: either
     * detector alarming, and not muted.
     *
     * This service owns every anchor-alarm sound on Android, in every app
     * state. Handing the sound to the WebView when the app was in the
     * foreground put it on the MEDIA stream (measured 2 of 15 on the field
     * device, against 11 of 15 for ALARM) and made an alarm with the app open
     * quieter than the same alarm with the screen off.
     */
    fun syncAnchorAlarmSound() {
        val wanted = !anchorAlarmMuted &&
            (anchorDetector?.alarmKind != null || jsAlarmRequested)
        if (wanted) startAnchorAlarmSound() else stopAnchorAlarmSound()
    }

    /**
     * The app's own GPS — possibly an external Bluetooth receiver this
     * service never sees — delivered a fix. Keeps the GPS-loss deadline
     * honest while the WebView is awake; see [AnchorWatchDetector.onExternalFix].
     */
    fun onExternalAnchorFix() {
        val detector = anchorDetector ?: return
        handleAnchorTransition(detector.onExternalFix(SystemClock.elapsedRealtime()))
        armAnchorWatchdog(detector.params.gpsLossAlarmMs)
    }

    /**
     * Distance-test one GNSS fix against the armed anchor.
     *
     * The fix's own accuracy goes with it: a poor one widens the radius the
     * detector alarms on rather than being rejected outright, so a marginal
     * position degrades the watch's resolution instead of either crying wolf
     * or going silent (see [effectiveAnchorRadiusM]).
     */
    private fun onAnchorFix(location: Location) {
        val detector = anchorDetector ?: return
        val provenBefore = detector.hadFix
        val transition = detector.onFix(
            location.latitude,
            location.longitude,
            SystemClock.elapsedRealtime(),
            if (location.hasAccuracy()) location.accuracy.toDouble() else ANCHOR_ACCURACY_UNKNOWN,
        )
        handleAnchorTransition(transition)
        // Silence only becomes an alarm relative to the newest fix.
        armAnchorWatchdog(detector.params.gpsLossAlarmMs)
        // One write per watch, on the edge: a restart must not downgrade a
        // proven watch to one that may never alarm on silence.
        if (!provenBefore) AnchorWatchStore.markHadFix(applicationContext)
    }

    /**
     * Cheap snapshot of whether the screen-off watch is actually watching.
     *
     * The app cannot tell from its own side: on a device whose internal GNSS
     * never produces a fix — no GPS hardware, permission declined, receiver
     * below decks — this service runs, holds its wake lock, and sees nothing,
     * and it deliberately stays silent about that (a watch that was never
     * proven has no basis for a GPS-loss alarm). So the app asks, and says so
     * in the armed panel; see assessScreenOffCover in
     * src/anchor/native-anchor-watch.ts.
     *
     * [AnchorWatchServiceStatus.hadFix] is GNSS-only by construction now (see
     * [startAnchorGnssUpdates]), which is the whole point: it used to go true
     * on a WiFi-derived fused position and report a covered watch on a tablet
     * that cannot see a satellite.
     */
    fun anchorStatus(): AnchorWatchServiceStatus {
        val detector = anchorDetector
        val now = SystemClock.elapsedRealtime()
        return AnchorWatchServiceStatus(
            armed = detector != null,
            hadFix = detector?.hadFix == true,
            lastFixAgeMs =
                if (detector != null && detector.hadFix) now - detector.lastFixElapsedMs else -1L,
            armedMs = if (detector != null) now - anchorDetectorSinceElapsedMs else -1L,
            wakeLockHeld = anchorWakeLock?.isHeld == true,
            alarmKind = detector?.alarmKind,
            gnssAvailable = anchorGnssAvailable,
        )
    }

    /** The GPS-loss deadline elapsed (or is still pending — re-arm and wait). */
    private fun onAnchorWatchdogFired() {
        val detector = anchorDetector ?: return
        val now = SystemClock.elapsedRealtime()
        handleAnchorTransition(detector.onTick(now))
        if (detector.alarmKind == null) {
            armAnchorWatchdog(
                maxOf(detector.gpsLossDeadlineElapsedMs() - now, ANCHOR_WATCHDOG_MIN_DELAY_MS),
            )
        }
    }

    private fun handleAnchorTransition(transition: AnchorTransition) {
        when (transition) {
            AnchorTransition.DRAG_ALARM -> raiseAnchorAlarm(ANCHOR_ALARM_DRAG)
            AnchorTransition.GPS_LOSS_ALARM -> raiseAnchorAlarm(ANCHOR_ALARM_GPS_LOSS)
            AnchorTransition.CLEARED -> clearAnchorAlarm()
            AnchorTransition.NONE -> Unit
        }
    }

    private fun raiseAnchorAlarm(kind: String) {
        val detector = anchorDetector
        val distanceM = detector?.lastDistanceM ?: 0.0
        DiagLog.log(
            applicationContext,
            "anchor",
            "ALARM $kind d=${distanceM.toInt()}m r=${detector?.effectiveRadiusM()?.toInt()}m " +
                "acc=${detector?.lastAccuracyM?.toInt()}m muted=$anchorAlarmMuted",
        )
        Log.w(TAG, "Anchor alarm: $kind at ${distanceM.toInt()}m")
        showAnchorNotification(kind, distanceM)
        // Retained event: JS is usually suspended when this fires and learns
        // about it on resume.
        anchorAlarmListener?.invoke(kind, distanceM, System.currentTimeMillis())
        syncAnchorAlarmSound()
    }

    /**
     * Drop the alarm notification and re-judge the noise — the JS watch may
     * still be alarming on its own (its detector sees the app's GPS, which can
     * be a receiver this service never hears from). The watch stays armed.
     */
    private fun clearAnchorAlarm() {
        syncAnchorAlarmSound()
        getSystemService(NotificationManager::class.java)?.cancel(ANCHOR_NOTIFICATION_ID)
    }

    /**
     * Loop the device's alarm ringtone on the alarm stream and vibrate until
     * acknowledged or disarmed — a one-shot notification sound does not wake
     * anyone. Vibration is the backstop if audio can't start at all, and the
     * stream is raised to an audible floor for the duration.
     */
    private fun startAnchorAlarmSound() {
        if (anchorAlarmSounding) return
        anchorAlarmSounding = true
        raiseAlarmVolume()
        vibrator()?.let { vib ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vib.vibrate(VibrationEffect.createWaveform(ANCHOR_VIBRATE_PATTERN, 0))
            } else {
                @Suppress("DEPRECATION")
                vib.vibrate(ANCHOR_VIBRATE_PATTERN, 0)
            }
        }
        if (anchorAlarmPlayer != null) return
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: return
        try {
            anchorAlarmPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                // The CPU must stay up between loops with the screen off.
                setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                setDataSource(applicationContext, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Anchor alarm audio failed; vibration only", e)
            DiagLog.log(applicationContext, "anchor", "alarm audio failed: ${e.message}")
            anchorAlarmPlayer?.release()
            anchorAlarmPlayer = null
        }
    }

    /**
     * Every path that ends the noise — acknowledge, Silence, mute, the boat
     * coming back inside, disarm, onDestroy — comes through here, which is
     * what makes the volume restore unmissable.
     */
    private fun stopAnchorAlarmSound() {
        if (!anchorAlarmSounding && anchorAlarmPlayer == null) return
        anchorAlarmSounding = false
        anchorAlarmPlayer?.let {
            try {
                if (it.isPlaying) it.stop()
            } catch (e: IllegalStateException) {
                // Player already torn down — nothing to stop.
            }
            it.release()
        }
        anchorAlarmPlayer = null
        vibrator()?.cancel()
        restoreAlarmVolume()
    }

    /**
     * Lift the ALARM stream to [ANCHOR_ALARM_VOLUME_FLOOR] for the duration of
     * the alarm. An anchor alarm the crew cannot hear is the failure this whole
     * subsystem exists to prevent, and a device left at 2 of 15 has no other
     * defence — the user is asleep and cannot turn it up. It never lowers the
     * volume, and [restoreAlarmVolume] puts back what it found.
     */
    private fun raiseAlarmVolume() {
        val am = getSystemService(AudioManager::class.java) ?: return
        val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        val current = am.getStreamVolume(AudioManager.STREAM_ALARM)
        val target = anchorAlarmRaiseIndex(current, max)
        if (target < 0) return
        try {
            am.setStreamVolume(AudioManager.STREAM_ALARM, target, 0)
            anchorAlarmPriorVolume = current
            anchorAlarmRaisedVolume = target
            DiagLog.log(applicationContext, "anchor", "alarm volume $current -> $target of $max")
        } catch (e: SecurityException) {
            // Do Not Disturb without notification-policy access refuses volume
            // changes. The alarm still sounds at whatever the user set, and the
            // armed panel has already been saying it may be too quiet.
            DiagLog.log(applicationContext, "anchor", "alarm volume raise blocked: ${e.message}")
        }
    }

    /** Put back the level the alarm raised, unless the user has since moved it. */
    private fun restoreAlarmVolume() {
        val prior = anchorAlarmPriorVolume
        val raised = anchorAlarmRaisedVolume
        anchorAlarmPriorVolume = -1
        anchorAlarmRaisedVolume = -1
        if (prior < 0) return
        val am = getSystemService(AudioManager::class.java) ?: return
        try {
            if (am.getStreamVolume(AudioManager.STREAM_ALARM) != raised) return
            am.setStreamVolume(AudioManager.STREAM_ALARM, prior, 0)
        } catch (e: SecurityException) {
            DiagLog.log(applicationContext, "anchor", "alarm volume restore blocked: ${e.message}")
        }
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VibratorManager::class.java))?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Vibrator::class.java)
        }

    /**
     * Post the alarm on its own high-importance channel: full-screen intent so
     * it shows over the lock screen, CATEGORY_ALARM, ongoing so it can't be
     * swiped away, and a single Silence action. Text-only and static — the
     * primary device is an e-ink BOOX with no colour and no animation.
     */
    private fun showAnchorNotification(kind: String, distanceM: Double) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentPending = PendingIntent.getActivity(
            this, 3, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val silencePending = PendingIntent.getService(
            this, 4,
            Intent(this, BackgroundTrackService::class.java).setAction(ACTION_ANCHOR_SILENCE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = if (kind == ANCHOR_ALARM_GPS_LOSS) "GPS LOST — anchor watch" else "ANCHOR DRAGGING"
        val text = if (kind == ANCHOR_ALARM_GPS_LOSS) {
            "No GPS fix. The anchor watch cannot see the boat."
        } else {
            "${distanceM.toInt()} m from the anchor."
        }
        val notification = Notification.Builder(this, ANCHOR_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentPending)
            .setFullScreenIntent(contentPending, true)
            .addAction(Notification.Action.Builder(null, "Silence", silencePending).build())
            .build()
        nm.notify(ANCHOR_NOTIFICATION_ID, notification)
    }

    /** Schedule the GPS-loss check [delayMs] out; pierces Doze like the GPS watchdog. */
    private fun armAnchorWatchdog(delayMs: Long) {
        val am = alarmManager ?: return
        val pi = anchorWatchdogPendingIntent ?: return
        am.cancel(pi)
        am.setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + delayMs,
            pi,
        )
    }

    private fun cancelAnchorWatchdog() {
        val am = alarmManager ?: return
        val pi = anchorWatchdogPendingIntent ?: return
        am.cancel(pi)
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
            manager.createNotificationChannel(buildAnchorChannel())
        }
    }

    /**
     * The anchor alarm channel. IMPORTANCE_HIGH so it heads-up and can carry a
     * full-screen intent. Channel sound and vibration are off on purpose: the
     * service owns both, looping until acknowledged, and a channel sound would
     * add a one-shot ringtone playing out of phase with that loop.
     */
    private fun buildAnchorChannel(): NotificationChannel {
        val channel = NotificationChannel(
            ANCHOR_CHANNEL_ID,
            "Anchor Alarm",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Sounds when the anchor watch detects dragging or loses GPS"
            setSound(null, null)
            enableVibration(false)
            enableLights(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        try {
            channel.setBypassDnd(true)
        } catch (e: SecurityException) {
            // Needs notification-policy access; without it the alarm is still
            // audible outside Do Not Disturb.
        }
        return channel
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

        // Running for the anchor watch alone: say so, and drop the Stop action
        // — it ends track recording, there is none, and standing a watch down
        // deliberately requires the app (same rule as the alarm's Silence).
        val anchorOnly = !trackingRequested && anchorParams != null
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Pelorus Nav")
            .setContentText(if (anchorOnly) "Anchor watch armed" else notificationText)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
        if (!anchorOnly) {
            builder.addAction(Notification.Action.Builder(null, "Stop", stopPending).build())
        }
        return builder.build()
    }

    /** Re-emit the foreground notification with the current [notificationText]. */
    fun refreshNotification() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.notify(NOTIFICATION_ID, buildNotification())
    }
}
