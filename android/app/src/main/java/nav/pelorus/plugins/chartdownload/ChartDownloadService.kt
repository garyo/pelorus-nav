package nav.pelorus.plugins.chartdownload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import nav.pelorus.plugins.backgroundgps.DiagLog

/**
 * Foreground service (type dataSync) that runs while chart downloads do.
 *
 * It downloads nothing itself — the WebView's OPFS write worker does the
 * fetching. What it provides is the foreground-service process state: Android
 * cuts the network of a backgrounded app that has none, which kills a
 * download the moment the user switches away. It also shows the download's
 * progress in a notification.
 *
 * Started, updated and stopped by [ChartDownloadPlugin]: from the JS download
 * queue, and when the activity and its WebView are destroyed. It stops itself
 * only when Android's dataSync time limit runs out (Android 15+, [onTimeout]);
 * the queue then resumes when the app returns to the foreground.
 */
class ChartDownloadService : Service() {
    companion object {
        const val CHANNEL_ID = "pelorus_chart_download_channel"
        const val NOTIFICATION_ID = 5
        const val EXTRA_TEXT = "text"
        const val EXTRA_PERCENT = "percent"
        private const val TAG = "dlsvc"

        /** The service, once it is in the foreground. */
        @Volatile
        var instance: ChartDownloadService? = null
            private set

        /**
         * Set by a stop that arrives while a start is still pending. Stopping
         * a service before it has called startForeground crashes the app, so
         * the pending start stops itself once it is in the foreground.
         */
        @Volatile
        var stopRequested = false

        /** Told when the service ends on its own, with the reason. */
        var stoppedListener: ((String) -> Unit)? = null
    }

    private var text = ""
    /** 0–100, or negative for an indeterminate bar. */
    private var percent = -1

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        text = intent?.getStringExtra(EXTRA_TEXT) ?: text
        percent = intent?.getIntExtra(EXTRA_PERCENT, percent) ?: percent
        try {
            createChannel()
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
            if (instance == null) DiagLog.log(this, TAG, "started: $text")
            instance = this
            if (stopRequested) stopSelf()
        } catch (e: Exception) {
            DiagLog.log(this, TAG, "foreground start refused: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
        }
        // Without the WebView that drives it, a restarted service has nothing to do.
        return START_NOT_STICKY
    }

    /** Show new progress in the notification. */
    fun update(text: String, percent: Int) {
        if (text == this.text && percent == this.percent) return
        this.text = text
        this.percent = percent
        getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, buildNotification())
    }

    /**
     * Android 15+ caps dataSync services at 6 hours a day, then calls this
     * and expects the service stopped within seconds. Downloads cut off by
     * the stop resume when the app is next in the foreground.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        DiagLog.log(this, TAG, "dataSync time limit reached; stopping")
        stoppedListener?.invoke("timeout")
        stopSelf()
    }

    override fun onDestroy() {
        instance = null
        DiagLog.log(this, TAG, "stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Chart Downloads",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shows progress while charts download"
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val launch = PendingIntent.getActivity(
            this, 0, packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("Downloading charts")
            .setContentText(text)
            .setSubText(if (percent >= 0) "$percent%" else null)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setProgress(100, percent.coerceIn(0, 100), percent < 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setContentIntent(launch)
            .build()
    }
}
