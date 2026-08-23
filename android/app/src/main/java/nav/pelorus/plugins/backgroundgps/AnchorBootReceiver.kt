package nav.pelorus.plugins.backgroundgps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.provider.Settings

/**
 * Reboot disclosure for an armed anchor watch.
 *
 * A device restart — OTA window, battery pull, kernel panic — kills the
 * foreground service and nothing recreates it: restarting a location
 * foreground service from boot is not permitted without background-location
 * permission, which this app deliberately does not hold. So the watch the
 * skipper armed is simply gone, and without this receiver it was gone
 * *silently* — the one failure mode an anchor alarm may never have. The
 * receiver cannot restore the watch; it can and does make the failure loud.
 *
 * Direct-boot aware, because a phone that reboots at 03:00 sits locked until
 * morning: the armed flag is mirrored into device-protected storage (see
 * [AnchorWatchStore.markArmedForBoot]) so LOCKED_BOOT_COMPLETED — which fires
 * before first unlock — can read it. The channel carries its own alarm-stream
 * sound and vibration: there is no service alive to loop the siren, so the
 * channel's one-shot default alarm is what wakes the skipper.
 */
class AnchorBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != Intent.ACTION_BOOT_COMPLETED
        ) {
            return
        }
        if (!AnchorWatchStore.wasArmedForBoot(context)) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(buildChannel())
        // Notified under a fixed id: LOCKED_BOOT_COMPLETED and BOOT_COMPLETED
        // both fire on unencrypted-profile devices; the second post replaces
        // the first instead of stacking.
        nm.notify(NOTIFICATION_ID, buildNotification(context))
        DiagLog.log(context, "anchor", "boot: armed watch not running — disclosed")
    }

    private fun buildChannel(): NotificationChannel =
        NotificationChannel(
            CHANNEL_ID,
            "Anchor Watch Interrupted",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Sounds when a device restart has stopped an armed anchor watch"
            setSound(
                Settings.System.DEFAULT_ALARM_ALERT_URI,
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            enableVibration(true)
            setBypassDnd(false)
        }

    private fun buildNotification(context: Context): Notification {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val contentPending = launch?.let {
            PendingIntent.getActivity(
                context, 6, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        return Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("ANCHOR WATCH NOT RUNNING")
            .setContentText(
                "This device restarted while the anchor watch was armed. " +
                    "Nothing is watching the anchor — open Pelorus Nav to re-arm.",
            )
            .setStyle(
                Notification.BigTextStyle().bigText(
                    "This device restarted while the anchor watch was armed. " +
                        "Nothing is watching the anchor — open Pelorus Nav to re-arm.",
                ),
            )
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .apply { contentPending?.let { setContentIntent(it) } }
            .build()
    }

    companion object {
        const val CHANNEL_ID = "pelorus_anchor_interrupted_channel"
        const val NOTIFICATION_ID = 4
    }
}
