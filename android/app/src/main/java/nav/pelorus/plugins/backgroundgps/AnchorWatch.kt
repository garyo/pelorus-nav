package nav.pelorus.plugins.backgroundgps

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Alarm kinds, matching AnchorAlarmKind in src/anchor/AnchorWatchManager.ts. */
const val ANCHOR_ALARM_DRAG = "drag"
const val ANCHOR_ALARM_GPS_LOSS = "gps-loss"

/** Earth radius used by haversineDistanceNM in src/utils/coordinates.ts. */
private const val EARTH_RADIUS_M = 3440.065 * 1852.0

/** Great-circle distance in meters, matching the JS geometry exactly. */
fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val dLat = (lat2 - lat1) * PI / 180.0
    val dLon = (lon2 - lon1) * PI / 180.0
    val a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1 * PI / 180.0) * cos(lat2 * PI / 180.0) * sin(dLon / 2) * sin(dLon / 2)
    return EARTH_RADIUS_M * 2 * atan2(sqrt(a), sqrt(1 - a))
}

/** An armed anchor watch as pushed from JS by setAnchorWatch(). */
data class AnchorWatchParams(
    val lat: Double,
    val lon: Double,
    val radiusM: Double,
    /** Continuous milliseconds outside the radius before the drag alarm fires. */
    val alarmDelayMs: Long,
    /** Milliseconds without an accepted fix before the GPS-loss alarm fires. */
    val gpsLossAlarmMs: Long,
    /** Further drag beyond the acknowledged distance that re-alarms, meters. */
    val reAlarmMarginM: Double,
)

/**
 * What the service can say about the watch it is running, for the app's
 * screen-off-cover disclosure. Mirrors AnchorWatchNativeStatus in
 * src/plugins/BackgroundGPS.ts; times are milliseconds, -1 when not armed.
 */
data class AnchorWatchServiceStatus(
    val armed: Boolean,
    /** This device's own GNSS has produced at least one fix for this watch. */
    val hadFix: Boolean,
    val lastFixAgeMs: Long,
    /** Time since this detector was armed — separates "acquiring" from "blind". */
    val armedMs: Long,
    val wakeLockHeld: Boolean,
    val alarmKind: String?,
    /**
     * This device has a GNSS receiver the watch can subscribe to. False on a
     * tablet with no GPS hardware (the e-ink case), where nothing the service
     * can do will ever produce a position of its own — see
     * BackgroundTrackService.startAnchorGnssUpdates.
     */
    val gnssAvailable: Boolean,
)

/**
 * Horizontal accuracy the JS alarm radius is already assumed to cover, meters.
 *
 * The radius the user armed is computed from rode + boat length + a GPS margin
 * (see anchor-setup.ts), and that margin is sized for the receiver the *app*
 * is using — often an external Bluetooth GPS reporting 3-5 m. The service
 * watches through the device's own chip, which under a coachroof or in a
 * marina can report far worse. This is the accuracy at which the device chip
 * is doing at least as well as the armed margin already assumes.
 */
const val ANCHOR_ASSUMED_ACCURACY_M = 10.0

/** An accuracy value from a fix that did not report one. */
const val ANCHOR_ACCURACY_UNKNOWN = -1.0

/**
 * The radius the native watch actually alarms on: the armed radius widened by
 * however much worse than [ANCHOR_ASSUMED_ACCURACY_M] this device's own fix is.
 *
 * Without this a small circle — a 25 m radius on a short scope in a crowded
 * anchorage — is swamped by the device chip's own uncertainty: a 40 m fix
 * error puts a stationary boat outside the ring and alarms at 3 a.m. with the
 * boat exactly where the user left it. Widening by only the *excess* (rather
 * than by the full accuracy) keeps the geometry the user set whenever the
 * device fix is as good as their margin already budgets for, and gives back
 * exactly the uncertainty the chip admits to when it is worse. It never
 * shrinks the radius, so it can only ever suppress a false alarm — the cost is
 * that a real drag on a device with a poor fix has to travel further before it
 * alarms, which is the honest trade: the position simply is not good enough to
 * say otherwise.
 */
fun effectiveAnchorRadiusM(radiusM: Double, accuracyM: Double): Double {
    if (!accuracyM.isFinite() || accuracyM <= 0) return radiusM
    return radiusM + maxOf(0.0, accuracyM - ANCHOR_ASSUMED_ACCURACY_M)
}

/** What a detector call changed about the alarm state. */
enum class AnchorTransition { NONE, DRAG_ALARM, GPS_LOSS_ALARM, CLEARED }

/**
 * Whether the service should make its own noise for an alarm.
 *
 * The native alarm is the one that survives a suspended WebView, so it sounds
 * in every state except the one where the app is demonstrably already sounding
 * its own: foreground AND handed off (see `handOffAnchorAlarm`). A started
 * activity is NOT enough — a WebView returning from suspension has a suspended
 * AudioContext and beats silently until a user gesture unlocks it, so treating
 * "activity started" as "JS is audible" turns waking the device into a way of
 * silencing the alarm.
 */
fun shouldSoundNativeAnchorAlarm(appForeground: Boolean, jsAlarmAudible: Boolean): Boolean =
    !(appForeground && jsAlarmAudible)

/**
 * Screen-off anchor-watch detection: the native mirror of
 * AnchorWatchManager's state machine (src/anchor/AnchorWatchManager.ts).
 * Backgrounded WebView JS is suspended and passive mode silences the
 * native→JS bridge, so overnight this class is the only thing watching.
 *
 * Pure logic — no Android dependencies — so it is directly unit-testable.
 * The caller feeds it every accepted fix plus periodic ticks and reacts to
 * the returned transition; the class itself makes no noise.
 *
 * **GNSS fixes only.** [onFix] means "this device's own satellite receiver saw
 * the boat here". A fused/network position — WiFi or cell trilateration — must
 * never reach it: those can be hundreds of metres out and jump between
 * neighbouring access points, which reads as a drag while the boat sits on its
 * anchor. Feeding them in is how this watch alarmed within seconds of arming
 * on a tablet with no GNSS at all. The caller enforces it by subscribing to
 * the GNSS provider directly (BackgroundTrackService.startAnchorGnssUpdates).
 *
 * Timing runs on a monotonic elapsed-realtime clock supplied by the caller
 * rather than on fix timestamps (which is what the JS side uses): the
 * device clock can step under NTP, and the same clock has to drive the
 * Doze-piercing AlarmManager deadline for the GPS-loss test.
 */
class AnchorWatchDetector(params: AnchorWatchParams) {

    companion object {
        /**
         * Rebuild the detector for a watch that outlived its process (see
         * AnchorWatchStore). What survives is deliberately just [hadFix]:
         *
         * - **[hadFix] survives.** It means "this device's own GPS was proven
         *   to work for this watch", and a process kill does not unprove it.
         *   Dropping it would silently switch the GPS-loss alarm off for the
         *   rest of the night — the exact silent death this class exists to
         *   prevent.
         * - **The GPS-loss deadline restarts** from [nowElapsedMs] rather than
         *   from the pre-kill fix time: we don't know how long the process was
         *   dead, and elapsed-realtime from before a reboot means nothing. So a
         *   restored watch alarms if it stays blind for a full
         *   [AnchorWatchParams.gpsLossAlarmMs] from the restart.
         * - **Hysteresis starts clean.** "Outside since" measures a
         *   *continuous* excursion; a gap of unknown length cannot count toward
         *   one, and carrying it would alarm on the first fix after a restart.
         * - **Acknowledgments do not survive.** An acknowledgment silences one
         *   event; once the process is gone, the safe default for a safety
         *   alarm is to alarm again.
         * - **A sounding alarm is not restored.** Its sound and notification
         *   died with the process, and re-raising one from stored state would
         *   be a phantom alarm. A boat that is still outside re-detects within
         *   one excursion delay of the first fix, which at the armed 5 s
         *   location cadence is seconds away.
         */
        fun restored(
            params: AnchorWatchParams,
            hadFix: Boolean,
            nowElapsedMs: Long,
        ): AnchorWatchDetector = AnchorWatchDetector(params).apply {
            if (!hadFix) return@apply
            this.hadFix = true
            this.lastFixElapsedMs = nowElapsedMs
        }
    }

    var params: AnchorWatchParams = params
        private set

    /** The alarm currently raised, or null. */
    var alarmKind: String? = null
        private set

    /** Distance from the last fix to the anchor, meters. Zero before any fix. */
    var lastDistanceM: Double = 0.0
        private set

    /**
     * A GNSS fix has arrived since this watch was armed. A watch that has
     * never seen one must not raise a GPS-loss alarm — it was never proven to
     * work, so silence is not new information (mirrors `hadFix` in the JS
     * state machine) — and must not claim screen-off cover either.
     */
    var hadFix: Boolean = false
        private set

    /**
     * Horizontal accuracy of the last fix, meters, or
     * [ANCHOR_ACCURACY_UNKNOWN]. Feeds [effectiveRadiusM].
     */
    var lastAccuracyM: Double = ANCHOR_ACCURACY_UNKNOWN
        private set

    /** Elapsed-realtime of the last accepted fix; meaningful once [hadFix]. */
    var lastFixElapsedMs: Long = 0L
        private set

    private var lastLat = 0.0
    private var lastLon = 0.0
    private var outsideSinceElapsedMs: Long? = null
    private var dragAcknowledged = false
    private var distanceAtAckM = 0.0
    private var gpsLossAcknowledged = false

    /** The radius this watch alarms on, given the last fix's own accuracy. */
    fun effectiveRadiusM(): Double = effectiveAnchorRadiusM(params.radiusM, lastAccuracyM)

    /**
     * Feed one GNSS fix (see the class doc — nothing else may call this).
     * Fresh data also ends any GPS-loss condition.
     */
    fun onFix(
        lat: Double,
        lon: Double,
        nowElapsedMs: Long,
        accuracyM: Double = ANCHOR_ACCURACY_UNKNOWN,
    ): AnchorTransition {
        hadFix = true
        lastFixElapsedMs = nowElapsedMs
        lastLat = lat
        lastLon = lon
        lastAccuracyM = accuracyM
        gpsLossAcknowledged = false
        var cleared = false
        if (alarmKind == ANCHOR_ALARM_GPS_LOSS) {
            alarmKind = null
            cleared = true
        }
        val transition = evaluate(nowElapsedMs)
        if (transition != AnchorTransition.NONE) return transition
        return if (cleared) AnchorTransition.CLEARED else AnchorTransition.NONE
    }

    /**
     * The app saw a fix from a source this service cannot: an external
     * Bluetooth GPS feeding the WebView. Only the GPS-loss side reacts — the
     * position is deliberately ignored, because drag detection must stay on
     * one consistent source (mixing a masthead receiver with the device chip
     * makes their offset look like movement the moment the app suspends).
     *
     * It also does not set [hadFix]: that flag means "the service's own GPS
     * has been proven to work", which is the only thing that makes later
     * silence alarm-worthy. Without it a tablet whose internal GPS never
     * sees the sky would alarm every night the moment the screen went off.
     */
    fun onExternalFix(nowElapsedMs: Long): AnchorTransition {
        lastFixElapsedMs = nowElapsedMs
        gpsLossAcknowledged = false
        if (alarmKind != ANCHOR_ALARM_GPS_LOSS) return AnchorTransition.NONE
        alarmKind = null
        return AnchorTransition.CLEARED
    }

    /**
     * Periodic check for silence. Called from the Doze-piercing anchor
     * watchdog, so it fires even with the CPU otherwise asleep.
     */
    fun onTick(nowElapsedMs: Long): AnchorTransition {
        if (!hadFix || alarmKind != null || gpsLossAcknowledged) return AnchorTransition.NONE
        if (nowElapsedMs - lastFixElapsedMs < params.gpsLossAlarmMs) return AnchorTransition.NONE
        alarmKind = ANCHOR_ALARM_GPS_LOSS
        return AnchorTransition.GPS_LOSS_ALARM
    }

    /**
     * The anchor moved or the radius changed: restart the excursion timer,
     * re-judge the last known position, and re-baseline any acknowledgment
     * against the new geometry.
     */
    fun updateParams(next: AnchorWatchParams, nowElapsedMs: Long): AnchorTransition {
        params = next
        outsideSinceElapsedMs = null
        if (!hadFix) return AnchorTransition.NONE
        val transition = evaluate(nowElapsedMs)
        if (dragAcknowledged) distanceAtAckM = lastDistanceM
        return transition
    }

    /**
     * Silence the current alarm; the watch keeps running. A drag alarm
     * re-fires on re-entry then exit, or — still outside — on a further
     * [AnchorWatchParams.reAlarmMarginM] of drag. Returns true when
     * something was actually silenced.
     */
    fun acknowledge(): Boolean {
        when (alarmKind) {
            ANCHOR_ALARM_DRAG -> {
                dragAcknowledged = true
                distanceAtAckM = lastDistanceM
            }
            ANCHOR_ALARM_GPS_LOSS -> gpsLossAcknowledged = true
            else -> return false
        }
        alarmKind = null
        return true
    }

    /** Elapsed-realtime at which silence becomes a GPS-loss alarm. */
    fun gpsLossDeadlineElapsedMs(): Long = lastFixElapsedMs + params.gpsLossAlarmMs

    private fun evaluate(nowElapsedMs: Long): AnchorTransition {
        val distanceM = haversineMeters(lastLat, lastLon, params.lat, params.lon)
        lastDistanceM = distanceM
        if (distanceM > effectiveRadiusM()) {
            val since = outsideSinceElapsedMs ?: nowElapsedMs.also { outsideSinceElapsedMs = it }
            if (dragAcknowledged) {
                // Still dragging: a further margin beyond the acknowledged
                // distance overrides the acknowledgment.
                if (distanceM >= distanceAtAckM + params.reAlarmMarginM) return startDrag()
            } else if (alarmKind != ANCHOR_ALARM_DRAG &&
                nowElapsedMs - since >= params.alarmDelayMs
            ) {
                return startDrag()
            }
        } else {
            outsideSinceElapsedMs = null
            if (alarmKind == ANCHOR_ALARM_DRAG || dragAcknowledged) {
                alarmKind = null
                dragAcknowledged = false
                return AnchorTransition.CLEARED
            }
        }
        return AnchorTransition.NONE
    }

    private fun startDrag(): AnchorTransition {
        alarmKind = ANCHOR_ALARM_DRAG
        dragAcknowledged = false
        return AnchorTransition.DRAG_ALARM
    }
}

/** What [syncServiceDemand] should do about the foreground service. */
enum class ServiceDemand { START, STOP, NONE }

/**
 * Decide whether the service must be started, stopped, or left alone.
 *
 * A running service that is still wanted is left alone: re-issuing a start
 * is only needed when its stickiness no longer matches whether a watch is
 * armed. Stopping is for the one case that means it — nothing wants it any
 * more. (Stopping a wanted-and-running service tore the watch down on every
 * geometry update; the anchor UI flapped between covered and not.)
 */
fun serviceDemandAction(
    wanted: Boolean,
    running: Boolean,
    stickinessStale: Boolean,
): ServiceDemand = when {
    wanted && (!running || stickinessStale) -> ServiceDemand.START
    !wanted && running -> ServiceDemand.STOP
    else -> ServiceDemand.NONE
}
