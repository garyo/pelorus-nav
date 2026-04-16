package nav.pelorus.plugins.backgroundgps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
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

class BackgroundTrackService : Service() {

    companion object {
        const val TAG = "BackgroundTrackService"
        const val CHANNEL_ID = "pelorus_track_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "nav.pelorus.STOP_TRACKING"

        /** Callback for delivering live location updates to the plugin (foreground only). */
        var locationListener: ((TrackPointRow) -> Unit)? = null

        /** Reference to the running service instance (for interval updates from plugin). */
        var instance: BackgroundTrackService? = null

        /** Desired GPS interval (ms) — JS can hint before going to background. */
        @Volatile var desiredIntervalMs: Long = 1000L

        /** When true, the service manages its own adaptive GPS rate. */
        @Volatile var adaptiveEnabled: Boolean = false

        // Speed threshold: 0.5 knots in m/s
        private const val STATIONARY_SPEED_MS = 0.26f
        private const val FAST_INTERVAL_MS = 2000L
        private const val MEDIUM_INTERVAL_MS = 5000L
        private const val SLOW_INTERVAL_MS = 30000L
        private const val STEADY_SAMPLES_REQUIRED = 15
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var trackDb: TrackDatabase
    private lateinit var locationCallback: LocationCallback
    private var cpuWakeLock: PowerManager.WakeLock? = null
    private var currentIntervalMs: Long = 1000L
    private var steadyCount: Int = 0

    override fun onCreate() {
        super.onCreate()
        instance = this
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        trackDb = TrackDatabase(this)

        // Acquire CPU wake lock to guarantee GPS callbacks on aggressive power-saving devices
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        cpuWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PelorusNav::TrackRecording")
        cpuWakeLock?.acquire()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (location in result.locations) {
                    val point = TrackPointRow(
                        timestamp = location.time,
                        lat = location.latitude,
                        lon = location.longitude,
                        speed = if (location.hasSpeed()) location.speed else -1f,
                        course = if (location.hasBearing()) location.bearing else -1f,
                        accuracy = if (location.hasAccuracy()) location.accuracy else -1f
                    )

                    // Always write to SQLite (background buffer)
                    trackDb.insertPoint(point)

                    // Deliver live update if plugin listener is attached (foreground)
                    locationListener?.invoke(point)

                    // Native adaptive rate control (when JS is suspended)
                    if (adaptiveEnabled && location.hasSpeed()) {
                        evaluateAdaptiveRate(location.speed)
                    }
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        createNotificationChannel()
        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)

        startLocationUpdates()
        Log.i(TAG, "Background track service started")

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        fusedClient.removeLocationUpdates(locationCallback)
        locationListener = null
        cpuWakeLock?.let { if (it.isHeld) it.release() }
        cpuWakeLock = null
        Log.i(TAG, "Background track service stopped")
    }

    @Suppress("MissingPermission") // Permission checked in the plugin before starting
    private fun startLocationUpdates() {
        currentIntervalMs = desiredIntervalMs
        applyLocationInterval(currentIntervalMs)
    }

    @Suppress("MissingPermission")
    private fun applyLocationInterval(intervalMs: Long) {
        if (!::fusedClient.isInitialized || !::locationCallback.isInitialized) {
            Log.w(TAG, "applyLocationInterval called before service initialized, skipping")
            return
        }
        fusedClient.removeLocationUpdates(locationCallback)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs)
            .setWaitForAccurateLocation(false)
            .build()
        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        Log.d(TAG, "GPS interval set to ${intervalMs}ms")
    }

    private fun evaluateAdaptiveRate(speedMs: Float) {
        val newIntervalMs = if (speedMs < STATIONARY_SPEED_MS) {
            steadyCount = 0
            SLOW_INTERVAL_MS
        } else {
            steadyCount++
            if (steadyCount >= STEADY_SAMPLES_REQUIRED) MEDIUM_INTERVAL_MS else FAST_INTERVAL_MS
        }

        if (newIntervalMs != currentIntervalMs) {
            currentIntervalMs = newIntervalMs
            applyLocationInterval(newIntervalMs)
        }
    }

    /** Called from the plugin when JS changes interval settings. */
    fun updateInterval() {
        if (adaptiveEnabled) {
            // Adaptive mode — reset steady count, native logic takes over
            steadyCount = 0
        } else {
            // JS-controlled mode — apply the desired interval directly
            currentIntervalMs = desiredIntervalMs
            applyLocationInterval(desiredIntervalMs)
        }
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
        // Tapping the notification opens the app
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Stop action
        val stopIntent = Intent(this, BackgroundTrackService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Pelorus Nav")
            .setContentText("Recording track")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .addAction(Notification.Action.Builder(
                null, "Stop", stopPending
            ).build())
            .build()
    }
}
