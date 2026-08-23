package nav.pelorus.plugins.backgroundgps

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Alarm kinds, matching AnchorAlarmKind in src/anchor/AnchorWatchManager.ts. */
const val ANCHOR_ALARM_DRAG = "drag"
const val ANCHOR_ALARM_GPS_LOSS = "gps-loss"

/**
 * The meta-alarm: not "the boat moved" or "the fix is gone", but "the anchor
 * watch itself is compromised — check it". Raised only by the native side
 * (its triggers matter precisely when the app may be asleep) and carries a
 * reason so the user knows what to check.
 */
const val ANCHOR_ALARM_WATCH_FAILURE = "watch-failure"

/**
 * Watch-failure reasons, matching WatchFailureReason in
 * src/anchor/AnchorWatchManager.ts; travel in the retained `anchorAlarm`
 * event and the alarm notification.
 */
const val ANCHOR_WATCH_FAILURE_NOTHING_WATCHING = "nothing-watching"
const val ANCHOR_WATCH_FAILURE_DEVICE_BATTERY = "device-battery"

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
 * How long after the last JS keepalive beat the JS watch stops counting as
 * alive. Three missed 10 s beats: one is ordinary jank, two could be a long
 * GC pause on a slow device, three means the WebView is throttled into
 * uselessness or frozen outright.
 */
const val ANCHOR_KEEPALIVE_STALE_MS = 30_000L

/**
 * A beat whose self-reported interval exceeds this is evidence of WebView
 * timer throttling — JS still runs, just late. Distinct from freezing (no
 * beat at all), and worth a diag line of its own.
 */
const val ANCHOR_KEEPALIVE_DRIFT_ANOMALY_MS = 15_000L

/**
 * The JS watch is provably alive: it has beaten this watch, and recently
 * enough. [lastKeepaliveElapsedMs] is elapsed-realtime of the newest beat, or
 * negative when there has never been one this watch.
 */
fun jsWatchAlive(lastKeepaliveElapsedMs: Long, nowElapsedMs: Long): Boolean =
    lastKeepaliveElapsedMs >= 0 &&
        nowElapsedMs - lastKeepaliveElapsedMs < ANCHOR_KEEPALIVE_STALE_MS

/**
 * The alarm-authority rule: the JS watch is the authoritative detector while
 * provably alive, so the native detector may announce an alarm — notification,
 * retained event, its own contribution to the alarm sound — only when the
 * keepalive is stale, or when there has never been a keepalive this watch (JS
 * never connected: a watch restored from disk after a process kill must still
 * alarm with no WebView anywhere). Native *detection* is never gated — state,
 * hadFix and fix logging run regardless — and neither is the JS-requested
 * sound path: JS asking for noise is always honored.
 */
fun nativeMayAnnounce(lastKeepaliveElapsedMs: Long, nowElapsedMs: Long): Boolean =
    !jsWatchAlive(lastKeepaliveElapsedMs, nowElapsedMs)

/**
 * ALARM-stream volume as a fraction of this device's maximum, or -1 when the
 * device cannot say. This is the stream the anchor alarm plays on, so it — not
 * the media stream the WebView would have used — decides whether anyone hears
 * it.
 */
fun alarmVolumeFraction(current: Int, max: Int): Double =
    if (max <= 0) -1.0 else (current.toDouble() / max).coerceIn(0.0, 1.0)

/**
 * Fraction of maximum the alarm stream is raised to while the alarm sounds.
 *
 * A safety alarm nobody can hear is not a safety alarm. Half scale was not
 * enough: a field report of "not very loud" came from a device already at 73%,
 * above the old floor, so no raise even applied. The target is a sleeping crew
 * behind a closed cabin door, possibly with an engine or wind noise, and the
 * cost of being too loud is a startled skipper for the few seconds until they
 * acknowledge — against a boat dragging onto rocks unheard. So: 0.9, one step
 * below maximum on a typical 15-step stream, which keeps a little headroom
 * against small-speaker distortion (a rattling speaker is *less* intelligible)
 * while being as loud as the device usefully goes. The change lasts only as
 * long as the alarm, and the previous level is put back when it stops — see
 * BackgroundTrackService.restoreAlarmVolume.
 */
const val ANCHOR_ALARM_VOLUME_FLOOR = 0.9

/**
 * The watch-failure floor is deliberately lower: it must wake a skipper, but
 * it says "check the watch", not "emergency". 0.6 of a 15-step stream is
 * index 9 — loud speech, clearly audible through a cabin at anchor-quiet
 * night levels, without the near-maximum jolt the drag siren earns. The
 * never-lower / restore semantics are identical; only the floor differs.
 */
const val ANCHOR_WATCH_FAILURE_VOLUME_FLOOR = 0.6

/** The volume level the given alarm kind sounds at when the user set none. */
fun anchorAlarmVolumeFloor(kind: String): Double =
    if (kind == ANCHOR_ALARM_WATCH_FAILURE) ANCHOR_WATCH_FAILURE_VOLUME_FLOOR
    else ANCHOR_ALARM_VOLUME_FLOOR

/**
 * The stream index the alarm sets while sounding, or -1 to leave it alone
 * (already there, or the stream is unusable).
 *
 * [userFraction] is the volume the skipper chose on the anchor alarm's own
 * slider, 0–1, or negative when they never set one (→ the per-kind default
 * floor). The chosen level is *absolute*: the stream is set to it in either
 * direction, overriding whatever the system volume happens to be — a skipper
 * sleeping next to the device chose that level deliberately and must not be
 * blasted because a video earlier pushed the alarm stream to maximum. The
 * watch-failure chirp keeps its quieter relationship at any setting (scaled
 * by the two floors' ratio). Never index 0: a sounding alarm may be quiet,
 * never silent — muting is its own explicit control.
 */
fun anchorAlarmTargetIndex(
    current: Int,
    max: Int,
    kind: String,
    userFraction: Double = -1.0,
): Int {
    if (max <= 0) return -1
    val chosen =
        if (userFraction in 0.0..1.0) {
            if (kind == ANCHOR_ALARM_WATCH_FAILURE) {
                userFraction * (ANCHOR_WATCH_FAILURE_VOLUME_FLOOR / ANCHOR_ALARM_VOLUME_FLOOR)
            } else {
                userFraction
            }
        } else {
            anchorAlarmVolumeFloor(kind)
        }
    val target = ceil(max * chosen).toInt().coerceIn(1, max)
    return if (current == target) -1 else target
}

/**
 * Urgency order for the alarm sound: a boat outside its circle beats a lost
 * fix beats a compromised watch. An unrecognized kind (a newer JS talking to
 * this service) ranks with GPS loss — wrong-but-alarming beats reassuring.
 */
private fun anchorAlarmSoundRank(kind: String): Int = when (kind) {
    ANCHOR_ALARM_DRAG -> 0
    ANCHOR_ALARM_GPS_LOSS -> 1
    ANCHOR_ALARM_WATCH_FAILURE -> 2
    else -> 1
}

/**
 * Which alarm tone to play, given what each detector is alarming on — this
 * service's own and the WebView's (pushed through setAnchorAlarmSound). Null
 * when neither wants noise; the more urgent kind wins when both are up
 * (drag > gps-loss > watch-failure), the native side on a tie.
 */
fun anchorAlarmSoundKind(nativeKind: String?, jsKind: String?): String? = when {
    nativeKind == null -> jsKind
    jsKind == null -> nativeKind
    anchorAlarmSoundRank(jsKind) < anchorAlarmSoundRank(nativeKind) -> jsKind
    else -> nativeKind
}

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

        /**
         * When the anchor watchdog must next run, given the alarm state. The
         * watchdog is the only caller of [onTick], so this must never say
         * "never" while a watch is armed: an armed watch with no scheduled
         * watchdog and no incoming fixes is a dead sensor that looks like a
         * safe boat. The three cases:
         *  - no alarm: wake at the GPS-loss deadline;
         *  - detected but suppressed (JS alive): wake when the keepalive
         *    verdict can flip, so the deferred announcement happens;
         *  - announced: keep ticking at the floor — the reviewed failure was
         *    an announced-then-acknowledged alarm orphaning the watchdog,
         *    which left GPS loss undetectable for the rest of the night when
         *    the GPS had died during the alarm.
         */
        fun watchdogDelayMs(
            alarmKind: String?,
            announced: Boolean,
            gpsLossDeadlineElapsedMs: Long,
            lastKeepaliveElapsedMs: Long,
            nowElapsedMs: Long,
            minDelayMs: Long,
        ): Long = when {
            alarmKind == null ->
                maxOf(gpsLossDeadlineElapsedMs - nowElapsedMs, minDelayMs)
            !announced ->
                maxOf(
                    lastKeepaliveElapsedMs + ANCHOR_KEEPALIVE_STALE_MS - nowElapsedMs,
                    minDelayMs,
                )
            else -> minDelayMs
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
    /**
     * A real position has been fed *this process*. [hadFix] survives a
     * restore but coordinates never do, so a restored detector must not
     * evaluate geometry until this is true — judging the placeholder (0,0)
     * reads as thousands of kilometres out and can raise a phantom drag.
     */
    private var hasPosition = false
    private var outsideSinceElapsedMs: Long? = null
    private var insideSinceElapsedMs: Long? = null
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
        hasPosition = true
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
        if (!hasPosition) return AnchorTransition.NONE
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
            insideSinceElapsedMs = null
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
            if (alarmKind == ANCHOR_ALARM_DRAG) {
                alarmKind = null
                return AnchorTransition.CLEARED
            }
            if (dragAcknowledged) {
                // The acknowledgment survives boundary flapping: at a tide
                // turn with the fix cloud straddling the ring, a single
                // inside fix used to erase it, and the next 15 s excursion
                // re-woke the crew at full volume — repeatedly, all through
                // the stand. Only a sustained return inside stands the
                // acknowledged event down; until then the +reAlarmMarginM
                // rule still alarms on genuine further drag.
                val inSince =
                    insideSinceElapsedMs ?: nowElapsedMs.also { insideSinceElapsedMs = it }
                if (nowElapsedMs - inSince >= ANCHOR_ACK_RESET_INSIDE_MS) {
                    dragAcknowledged = false
                    insideSinceElapsedMs = null
                    return AnchorTransition.CLEARED
                }
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

/**
 * Continuous time back inside the ring before an acknowledged drag event
 * stands down (re-arming the full alarm for any later excursion). One fix
 * inside is boundary noise; a minute inside is the boat genuinely back.
 */
const val ANCHOR_ACK_RESET_INSIDE_MS = 60_000L

/** What a watch-failure monitor's check changed. */
enum class WatchFailureTransition { NONE, RAISE, CLEAR }

/**
 * How long the JS keepalive must have been silent before it counts toward
 * "nothing is watching". Twice [ANCHOR_KEEPALIVE_STALE_MS]: staleness hands
 * alarm authority to the native detector, which is routine (every screen-off
 * night does it); this is the stronger claim that the JS watch is well and
 * truly gone.
 */
const val NOTHING_WATCHING_KEEPALIVE_SILENT_MS = 60_000L

/**
 * How long "nothing is watching" must hold continuously before the meta-alarm
 * fires. Generous on purpose: arming indoors and walking the phone out to the
 * boat with the screen off is exactly this state for a few minutes, and the
 * first GNSS fix on deck ends it — a real dead watch stays in it all night.
 */
const val NOTHING_WATCHING_PERSIST_MS = 180_000L

/**
 * The "nothing is watching" half of the watch-failure meta-alarm.
 *
 * The two detectors cover each other almost everywhere: JS watches while it
 * runs, and the native GNSS detector carries the watch once the WebView
 * freezes (measured ~90 s after screen-off on a phone). The one uncovered
 * corner is *both* gone at once — the JS keepalive silent AND this device's
 * own GNSS never having produced a fix this watch (a phone armed indoors; a
 * GNSS-less tablet whose Bluetooth GPS died after its JS froze). Then nobody
 * is watching the boat, no drag or GPS-loss alarm can ever fire, and the only
 * honest move is to wake the skipper and say so.
 *
 * Pure logic, caller-clocked like [AnchorWatchDetector]. Fed by the 5 s
 * keepalive check while armed and by the Doze-piercing anchor watchdog.
 * The condition clears (and the state resets) the moment a GNSS fix arrives —
 * `hadFix` latches, so this alarm can fire at most until the watch is first
 * proven — or the keepalive resumes. An acknowledgment silences the current
 * event only: it re-fires only if the condition clears and then recurs, never
 * periodically while unchanged.
 */
class NothingWatchingMonitor {

    /** The meta-alarm is raised and unacknowledged. */
    var alarming = false
        private set

    /** Silenced by the user while the condition still holds. */
    private var acknowledged = false

    /** Elapsed-realtime when the condition was first seen holding, or null. */
    private var conditionSinceElapsedMs: Long? = null

    fun check(
        hadFix: Boolean,
        lastKeepaliveElapsedMs: Long,
        nowElapsedMs: Long,
    ): WatchFailureTransition {
        val jsSilent = lastKeepaliveElapsedMs < 0 ||
            nowElapsedMs - lastKeepaliveElapsedMs >= NOTHING_WATCHING_KEEPALIVE_SILENT_MS
        if (hadFix || !jsSilent) {
            val wasAlarming = alarming
            alarming = false
            acknowledged = false
            conditionSinceElapsedMs = null
            return if (wasAlarming) WatchFailureTransition.CLEAR else WatchFailureTransition.NONE
        }
        val since = conditionSinceElapsedMs
            ?: nowElapsedMs.also { conditionSinceElapsedMs = it }
        if (alarming || acknowledged) return WatchFailureTransition.NONE
        if (nowElapsedMs - since < NOTHING_WATCHING_PERSIST_MS) return WatchFailureTransition.NONE
        alarming = true
        return WatchFailureTransition.RAISE
    }

    /** Silence the current event; returns true when something was silenced. */
    fun acknowledge(): Boolean {
        if (!alarming) return false
        alarming = false
        acknowledged = true
        return true
    }
}

/**
 * Battery level at or below which the watch-failure alarm fires while the
 * device is not charging. 15% is where Android's own low-battery warning
 * lives, and it leaves a skipper woken at anchor enough charge to actually
 * go find the cable.
 */
const val ANCHOR_BATTERY_LOW_PCT = 15

/**
 * One further, final re-fire when the battery keeps falling — the last call
 * before the watch dies with the device. Below Android's default 10%
 * power-saver kick-in, so this only speaks when the situation is genuinely
 * terminal.
 */
const val ANCHOR_BATTERY_CRITICAL_PCT = 7

/**
 * Charging must hold this long before the battery alarm's fired-once
 * latches reset. A charger that genuinely fell out overnight still gets a
 * fresh alarm on the next decline; a flapping connection does not.
 */
const val ANCHOR_BATTERY_RESET_CHARGING_MS = 120_000L

/** Level/scale from ACTION_BATTERY_CHANGED as a percent, -1 when unreadable. */
fun batteryPercent(level: Int, scale: Int): Int =
    if (level < 0 || scale <= 0) -1 else (level * 100 / scale).coerceIn(0, 100)

/**
 * The device-battery half of the watch-failure meta-alarm: an anchor watch on
 * a dying device is a watch about to fail silently, which the competitive
 * survey found is table stakes for this category.
 *
 * Fires once at [ANCHOR_BATTERY_LOW_PCT] while not charging; an
 * acknowledgment silences it, and it speaks exactly once more if the level
 * later reaches [ANCHOR_BATTERY_CRITICAL_PCT] still uncharged. Plugging in
 * clears the state entirely — including the fired-once latches, so a charger
 * that falls out overnight gets a fresh alarm on the next decline. An
 * unreadable reading changes nothing.
 */
class BatteryWatchMonitor {

    /** The meta-alarm is raised and unacknowledged. */
    var alarming = false
        private set

    private var firedLow = false
    private var firedCritical = false

    private var chargingSinceElapsedMs: Long? = null

    fun check(percent: Int, charging: Boolean, nowElapsedMs: Long): WatchFailureTransition {
        if (percent < 0) return WatchFailureTransition.NONE
        if (charging) {
            // Silence immediately — plugging in is the fix — but reset the
            // fired-once latches only after sustained charging: a vibrating
            // 12 V plug or cycling inverter that flaps the charging state at
            // 15% used to earn a fresh full alarm on every unplugged sample.
            val since =
                chargingSinceElapsedMs ?: nowElapsedMs.also { chargingSinceElapsedMs = it }
            if (nowElapsedMs - since >= ANCHOR_BATTERY_RESET_CHARGING_MS) {
                firedLow = false
                firedCritical = false
            }
            val wasAlarming = alarming
            alarming = false
            return if (wasAlarming) WatchFailureTransition.CLEAR else WatchFailureTransition.NONE
        }
        chargingSinceElapsedMs = null
        if (!firedLow && percent <= ANCHOR_BATTERY_LOW_PCT) {
            firedLow = true
            // Already critical at first sight: one alarm, not two in a row.
            if (percent <= ANCHOR_BATTERY_CRITICAL_PCT) firedCritical = true
            alarming = true
            return WatchFailureTransition.RAISE
        }
        if (firedLow && !firedCritical && percent <= ANCHOR_BATTERY_CRITICAL_PCT) {
            firedCritical = true
            alarming = true
            return WatchFailureTransition.RAISE
        }
        return WatchFailureTransition.NONE
    }

    /** Silence the current event; returns true when something was silenced. */
    fun acknowledge(): Boolean {
        if (!alarming) return false
        alarming = false
        return true
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

// --- Self-cleared alarm record ---------------------------------------------

/**
 * How many self-cleared alarms the record notification lists. Older events
 * age out silently; the count in the title stays honest for what is shown.
 */
const val ANCHOR_EVENT_RECORD_MAX = 6

/**
 * An alarm that sounded and then cleared on its own — GPS came back, the
 * boat swung back inside the circle, the watch-failure condition ended.
 * The user may have heard only unexplained beeps (or nothing at all), so
 * the event is kept for a quiet record notification that outlives the
 * alarm itself. [wallMs] is wall-clock, for display.
 */
data class AnchorAlarmEvent(val kind: String, val reason: String?, val wallMs: Long)

/**
 * Short label for the record title. Both GPS kinds read "GPS signal lost":
 * to the skipper the distinction between a fix stream that stopped and a
 * watch that never saw one is diagnostics, not news — the news is that the
 * watch lost its eyes for a while. Diag logs keep the precise kind.
 */
fun anchorAlarmEventTitleLabel(kind: String, reason: String?): String = when (kind) {
    ANCHOR_ALARM_WATCH_FAILURE ->
        if (reason == ANCHOR_WATCH_FAILURE_DEVICE_BATTERY) "device battery low"
        else "GPS signal lost"
    ANCHOR_ALARM_GPS_LOSS -> "GPS signal lost"
    else -> "dragging detected"
}

/**
 * One body line's description, true at read time: the record posts only
 * after the condition ended, and how it ended differs by kind — a GPS-loss
 * alarm clears only when the fix returns, a nothing-watching clear may
 * still be fixless, a cleared drag means the boat came back inside.
 */
fun anchorAlarmEventLine(kind: String, reason: String?): String = when (kind) {
    ANCHOR_ALARM_GPS_LOSS -> "lost GPS signal, fix returned"
    ANCHOR_ALARM_WATCH_FAILURE ->
        if (reason == ANCHOR_WATCH_FAILURE_DEVICE_BATTERY) "device battery low"
        else "lost GPS signal, waiting for fix"
    else -> "dragging detected, back inside the circle"
}

/** Record-notification title: the latest event, with a count when repeated. */
fun anchorEventRecordTitle(events: List<AnchorAlarmEvent>): String {
    val latest = events.last()
    val label = anchorAlarmEventTitleLabel(latest.kind, latest.reason)
    return if (events.size > 1) "Anchor alarms (${events.size}): $label"
    else "Anchor alarm: $label"
}

/**
 * Record-notification body: one line per event, newest first, then the
 * reassurance that matters — the watch is still armed. [formatTime] renders
 * a wall-clock ms timestamp, injected so callers use the device locale and
 * tests stay deterministic.
 */
fun anchorEventRecordText(
    events: List<AnchorAlarmEvent>,
    formatTime: (Long) -> String,
): String {
    val lines = events.asReversed().map {
        "${formatTime(it.wallMs)} — ${anchorAlarmEventLine(it.kind, it.reason)}"
    }
    return (lines + "Still armed.").joinToString("\n")
}
