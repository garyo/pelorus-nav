# Anchor Watch — Design (draft for discussion)

Working doc, not committed to the roadmap yet. Sources: competitive survey
(AnchorPro, Aqua Map, SailGrib, Anchor Sentry, OpenCPN WatchDog, TimeZero,
Vesper/Cortex, Signal K plugins, forum sentiment) + codebase reuse inventory,
2026-08-21 session.

## The one hard truth

Screen-off drag detection **cannot run in JS**: backgrounded WebView is
suspended, and passive mode silences the native→JS bridge. Detection and the
alarm must live in the native layer on both platforms:

- **Android** (`BackgroundTrackService.kt`): distance test per accepted fix
  against anchor lat/lon + radius; new HIGH-importance notification channel
  (alarm-stream sound + vibration + full-screen intent) — today's channel is
  deliberately silent (IMPORTANCE_LOW). Doze survival machinery
  (AlarmManager watchdog, wake locks) already exists and is field-validated.
- **iOS** (`BackgroundGPSPlugin.swift`): geofence test in
  `didUpdateLocations`; the passive 15 m distance filter means the delegate
  is silent at anchor and wakes exactly on movement — near-zero cost.
  Alerting needs `UNUserNotificationCenter` local notifications
  (time-sensitive interruption level; Critical Alerts entitlement = later,
  needs Apple approval).
- Plugin API (built on Android):
  `setAnchorWatch({lat, lon, radiusM, alarmDelayS, gpsLossAlarmS, warnM})` /
  `clearAnchorWatch()` / `acknowledgeAnchorAlarm()` /
  `setAnchorAlarmSound({sounding, muted})` / `noteExternalFix()`, plus a
  retained `anchorAlarm` event (`{kind, distanceM, at}`) so JS reconciles on
  resume via `AnchorWatchManager.noteNativeAlarm()`. `warnM` doubles as the
  re-alarm margin past an acknowledged distance. JS↔native plumbing is
  `src/anchor/native-anchor-watch.ts`.
- **The service is a client of the watch, not of track recording.** Arming
  starts it (prompting for location permission if needed) whatever GPS
  source the app displays, and disarming stops it only if recording doesn't
  still need it. With no tracking client its fixes feed the detector and
  nothing else — no SQLite, no bridge fanout, and the notification says
  "Anchor watch armed" with no Stop action. This matters because a boat
  with an external Bluetooth GPS has no device-GPS provider running at all:
  the device chip is the watch's own, independent position source, and the
  app's external fixes reach the detector only as `noteExternalFix()`
  (GPS-loss deadline only — mixing two receivers' positions would make
  their offset look like a drag the moment the app suspends).
- **Deep sleep**: an armed watch holds a continuous PARTIAL_WAKE_LOCK and
  floors the location interval at 5 s. Screen-off via the power button
  survives without it; a BOOX with its magnetic cover closed does not.
- **The service owns the alarm sound, in every app state.** Android routes
  Web Audio to the MEDIA stream (measured 2 of 15 on a Samsung test device,
  against 11 of 15 on ALARM), so a JS-sounded alarm with the app *open* was
  quieter than the same alarm with the screen off. Detection still runs on
  both sides; whichever side raises an alarm, the noise is the service
  looping the app's own tone on `USAGE_ALARM`, asked for by JS through
  `setAnchorAlarmSound({sounding, muted, kind})` and reference-counted
  against the service's own detector (`src/anchor/native-anchor-alarm.ts`).
  Mute is the only thing that silences both. While the alarm sounds the
  service lifts the ALARM stream to 0.9 of scale and puts the user's level
  back when it stops (Do Not Disturb can refuse; the armed panel discloses a
  low stream either way). On web JS keeps sounding for itself — Web Audio is
  all there is.
- **The alarm has one voice on every platform.** The three cadences live in
  `src/anchor/anchor-alarm-tones.ts`: drag is the two-tone 880/660 Hz siren
  on a 1.2 s beat, GPS loss a steady 520 Hz on a 2 s beat, and watch failure
  three short 660 Hz chirps on a 3 s beat — gentler on purpose, "check the
  watch" rather than "emergency". Web Audio synthesizes them (`CobAlarm`);
  Android loops a one-beat WAV per kind from `res/raw/`, rendered from those
  same constants by `bun tools/gen-alarm-sounds.ts` (re-run it after changing
  them). The service used the *device's* default alarm ringtone once and it
  was a steel-drum tune on the tester's Samsung — recognisable as nothing,
  alarming as nothing. `kind` is what keeps a JS-detected drag sounding like
  a drag; with several alarms up, drag > gps-loss > watch-failure. The
  volume floor differs by kind too: drag and GPS loss lift the ALARM stream
  to 0.9 of scale, watch failure to 0.6 (same never-lower/restore
  semantics). If the resource ever fails to load the service falls back to
  vibration plus the full-screen notification.
- **The watch-failure meta-alarm: "the watch itself is compromised — check
  it."** Native-only (both triggers matter precisely when the app may be
  asleep; on web there is no meta-alarm), one kind (`watch-failure`) with a
  `reason` in the retained event and notification, checked in the armed 5 s
  keepalive loop and backstopped by the Doze-piercing anchor watchdog. Pure
  state machines in `AnchorWatch.kt` (`NothingWatchingMonitor`,
  `BatteryWatchMonitor`), unit-tested:
  - **nothing-watching** — the uncovered corner between the two detectors:
    the JS keepalive silent ≥ 60 s (twice the authority-handover staleness)
    AND the native detector has never had a GNSS fix this watch (`hadFix`
    false), held continuously for 3 minutes (generous, so arming indoors and
    walking the phone to the boat doesn't false-fire). A GNSS fix or a
    resumed keepalive clears it and resets the clock; `hadFix` latches, so a
    once-proven watch can never fire this again. Field context: a phone's
    WebView freezes ~90 s after screen-off and the native watchdog carries
    the watch — this trigger is for when *that* watchdog is blind too.
  - **device-battery** — level ≤ 15% while not charging (read from the
    sticky `ACTION_BATTERY_CHANGED` intent, no receiver churn); acknowledge
    silences it, one final re-fire at ≤ 7%, and plugging in clears the state
    entirely (a charger that falls out re-alarms on the next decline).
  Acknowledge semantics match the real alarms (Silence/tap quiets, watch
  keeps running); a raise re-fires only when its condition clears and
  recurs, never periodically. Because JS cannot observe either condition, a
  retained `anchorAlarmCleared` event tells it when one ends —
  `AnchorWatchManager.noteNativeAlarm`/`noteNativeAlarmCleared` adopt and
  drop it, and the banner shows "ANCHOR WATCH IMPAIRED" with the reason. A
  detector alarm outranks it everywhere (notification, tone, banner), and
  clearing the detector alarm falls back to the still-standing meta-alarm's
  presentation.
- **One detector announces at a time; a JS keepalive decides which.** The two
  detectors watch different position sources with different radii (the native
  one widens by the device fix's excess accuracy), so run with equal authority
  they can disagree, double-alarm, or diverge on acknowledge state. Rule: the
  **JS watch is the authoritative detector while provably alive**, proven by
  an `anchorKeepalive({sinceLastMs})` heartbeat every 10 s from
  `native-anchor-watch.ts` while armed. The native detector runs its state
  machine, `hadFix`, and fix logging the whole time regardless, but
  *announces* an alarm — notification, retained `anchorAlarm` event, its own
  claim on the alarm sound — only when the beats are ≥30 s stale or never
  happened this watch (a watch restored from disk after a process kill, with
  no WebView anywhere, must still alarm). A detection suppressed while JS is
  alive is announced the moment the keepalive goes stale (a 5 s service-side
  check while armed, backstopped by the Doze-piercing anchor watchdog for the
  no-fixes case); JS asking for noise through `setAnchorAlarmSound` is never
  gated. The heartbeat doubles as a **measured liveness curve** on the device
  diag log — transitions only (`js keepalive STALE after Ns` / `resumed
  gap=Ns drift=M`), plus `js throttled sinceLast=Mms` when a beat's
  self-reported interval shows WebView timer throttling, and `native detect
  suppressed (js alive) d=Nm` once per excursion as field data for comparing
  the two detectors' verdicts. Acknowledge syncs both ways: the
  notification's Silence action fires a retained `anchorAcknowledged` event
  (notification path only, so JS-initiated acknowledges can't loop) that JS
  folds into its own manager.

Everything else reuses existing infrastructure: CobAlarm (parameterize
cadence), hold-gesture, the COB manager/panel/slot-persistence template,
`accuracyCircleGeoJSON` + MeasurementLayer rendering pattern, GPS quality/
staleness signals, tides API, SurfaceManager/StatusBanner/settings plumbing.

## V1 feature set

**Arming** (survey: "arm after the fact" is table stakes — nobody taps at the
moment of drop):
- Hold-to-arm (reuse hold-gesture). Anchor position via: current position
  (default), distance + bearing from current position, or map tap.
  Drag-to-adjust afterward (DraggablePoints pattern).
- Radius default computed: rode + boat length + GPS margin (SailGrib's
  documented formula), floored by live GPS scatter (`getQualitySignals`).
  Manual override always.

**Watch logic** (all in JS while visible; mirrored natively for screen-off):
- Two-stage: warning ring at a **fixed distance inside the edge** (Sabado
  lesson: consistent regardless of circle size) → soft alert; alarm radius →
  full alarm.
- Exit hysteresis: N seconds outside before full alarm; re-entry within the
  delay cancels (Aqua Map's "alarm delay").
- **GPS-loss alarm**: staleness beyond ~2 min while armed = alarm (distinct
  cadence). A dead sensor must never look like a safe boat. (OpenCPN's
  "Alarm if no Data"; nothing in our codebase does this today.)
- Acknowledged alarms **re-arm** — never one-shot (dragging boats keep
  dragging).
- States: green (inside warning) / yellow / red (alarming) / gray
  (insufficient GPS) — Aqua Map's model.

**UX architecture — anchor mode** (decided 2026-08-21):
- No persistent main-screen button. A **menu item enters "anchor mode"** —
  same pattern as measure/plot/route-edit (InteractionMode + its own
  SurfaceManager surfaces, other panels closed on entry).
- The mode owns a **setup surface**: boat params (length, bow height) and
  per-anchorage inputs (rode out, depth), each defaulted as best we can and
  **remembered across sessions** — persisted like settings but presented in
  the mode's own UX, not in the Settings panel.
- In-mode chart display: watch circle + warning ring + anchor icon +
  **swing scatter** since arming (the #1 "swinging or dragging?" diagnostic).
  Scatter kept in the manager (bounded ring buffer, persisted in the slot),
  session-scoped — never written to the track store. E-ink: throttle scatter
  repaints (30 s, like chart-auto-fit).
- In-mode panel mirroring CobPanel: big distance-to-anchor readout, bearing
  (doubles as dinghy-return aid), radius, time at anchor, GPS
  quality/accuracy, tide-scope line, mute, arm/disarm.
- **Once armed, the user can leave anchor mode**; a compact armed-status
  indicator appears in the main UX (state-colored green/yellow/red/gray,
  shows distance) — tapping it re-enters anchor mode for detail/disarm.
  The alarm itself is a `priority` surface that appears regardless of mode.

**Tide-aware scope — our headline differentiator** (near-zero cost for us,
almost nobody has it):
- At arm time, take depth (manual entry v1; Signal K later) + rode + bow
  height → show current scope ratio AND the ratio at the next high water
  from the offline tide predictor: "6:1 now → 4.2:1 at HW 04:12". Warn if
  it crosses a threshold. Needs a ~5-line nearest-station picker over
  `stationsInBounds`.

**Robustness** (the category's failure modes are all silent-death):
- Armed state persists in a storage slot (COB pattern); restart while armed
  restores armed (and mid-alarm restores alarming).
- Arming keeps GPS alive screen-off: wrap GpsPowerManager's RecordingSource
  as `isRecording() || anchorWatch.isArmed()` — no forced track recording.
- Low-battery alarm on the watching device — shipped natively as the
  watch-failure meta-alarm's `device-battery` trigger (see the alarm section;
  survey: table stakes for the category). iOS later, with its native watch.
- Arm-time self-checks: audio unlocked (CobAlarm blocked-detection exists),
  notification permission granted, GPS fresh — surface every gap as a
  StatusBanner *at arm time*, not at 3am.

## Deliberately NOT in V1

- Sector/polygon zones (AnchorPro two-radii, SailGrib hexagon) — circle +
  after-the-fact adjustment covers most; sector is the best v2 candidate.
- Heading-based bow-offset anchor placement (needs heading at rest — Signal K
  boats only) and anchor-position recalibration from swing arcs (Vesper).
- Remote monitoring/mirroring (Aqua Map AnchorLink class) — big; possible
  later via our worker + ntfy-style push. Also the BLE "anchor siren pod"
  hardware tie-in (ESP32 pod already exists as a platform).
- Engine-on / SOG-sustained auto-silence (v2: "you're moving — disarm?"
  prompt from sustained SOG is cheap and kills the forgot-to-disarm alarm).
- Auto-arming, prohibited zones from ENC features, wind/depth condition
  alarms, Signal K `navigation.anchor.*` publishing (v2 — the de facto
  interop path), iOS Live Activity.

## Decisions (settled 2026-08-21)

- **Entry UX**: menu item → anchor mode with its own surfaces; boat/anchorage
  params entered in-mode with remembered defaults (no Settings-panel section
  needed). Armed-status indicator in the main UX once armed.
- **Platform order**: Android native work first; iOS fast-follow.
- **Scatter retention**: local/temporary only (bounded, in the slot) — never
  a track.

- **Disarm friction**: tap the alarm = acknowledge/mute this event
  (auto-re-arms); hold = fully disarm.
- **Armed-status indicator**: corner badge on the map (state color + live
  distance, tap to re-enter anchor mode); iterate placement per device size.

## Laptop-overnight use case

A laptop on 12V/USB with its own or Bluetooth GPS is a viable all-night
watch **with the lid open**: the existing WakeLockController holds a screen
wake lock, which prevents system sleep while plugged in, and the
foreground-visible JS detection path covers it fully (no native layer
involved). The arm-time self-check requests the wake lock and warns if it
can't be held; lid-closed sleep is unfixable and gets a user-guide note.

## Build order sketch

1. Manager/state/slot + geometry + JS-side detection & alarm (visible-mode
   works end-to-end; simulator-driven E2E for drag scenarios).
2. Anchor mode: InteractionMode + setup surface (params w/ remembered
   defaults) + chart layer (circle/ring/anchor/scatter) + in-mode panel +
   armed-status indicator in the main UX.
3. Tide-aware scope readout.
4. Android native geofence + alarm channel + retained event.
5. iOS native geofence + local notifications.
6. GpsPowerManager wiring + battery/self-check polish + docs/user guide.
