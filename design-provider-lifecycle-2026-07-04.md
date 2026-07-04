# Design: provider lifecycle sweep + native GPS duty cycle

Review items 7+8 from code-review-2026-07-02.md, designed together (they touch
the same provider classes). Produced by a Fable design pass 2026-07-04,
re-verified against HEAD `2295da7`. Implementation sequence at the bottom;
commits 1–2 landed same-day, 3–8 pending.

## Core decision: composition, not inheritance (Nav-15)

The two BLE providers' *acquisition flows* (picker / getDevices rehydrate /
BT-off handling) are field-proven and stay in the providers verbatim. What
extracts into a shared `src/navigation/ReconnectingTransport.ts` core is the
mechanical state machine both duplicate (~140 lines each): intent flags,
exponential backoff (1s→30s ×2, reset on success), 4s/8s silence watchdog,
`establishing` guard, and a new post-establish intent re-check (Nav-5 — tears
down the link if disconnect() raced the await, fixing the single-client-slot
leak on both platforms).

Core API sketch: `noteConnectRequested/noteDisconnectRequested/dropIntent`,
`runEstablish(cause)`, `requestRetry`, `noteData`, `noteLinkDropped`,
`suspend/resume` (BT-off), `setPacing(relaxed)` (hidden+not-recording → ×10
backoff), `scheduleReconnect`, injected ops:
`{ establish(cause), teardown(), escalateRecovery?(err), attemptDetail?(cause) }`.
Web's watchAdvertisements escalation and native's BT-off detect live in
`escalateRecovery` (return true = core idles until requestRetry).

**Sacred-path contract:** backoff sequence/log strings identical; watchdog
becomes started-on-connect/stopped-on-drop (observable behavior unchanged —
today's tick early-returns while disconnected); BOTH existing BLE test files
must pass UNMODIFIED in the extraction commit — any needed test edit is a
design smell, stop and reassess. Manual pod smoke test before merge
(connect, pod power-cycle, walk-away/return, BT toggle, restart rehydrate).

## Per-provider migrations

- **SignalKProvider** (rewrite on the core): Nav-1 close race fixed by
  closure capture (`if (this.ws !== sock) return` in onclose); Nav-2 gains
  reconnect+watchdog+isReconnecting+notices; 8b-4 `setDesiredIntervalMs(ms)`
  (clamp 1–10s, quantize whole seconds) re-subscribes with the hinted
  `period` (unsubscribe path:"*" then subscribe; URL already ?subscribe=none
  so no double-stream). setUrl → teardown + requestRetry. Silence limit
  scaled: max(10_000, desiredPeriod*4).
- **WebSerialNMEAProvider**: Nav-4 wedge fixed with `finally` → noteLinkDropped;
  reconnect via `navigator.serial.getPorts()` (granted ports reopen with NO
  gesture — verified); saved vendor/product match (localStorage
  "pelorus-nav-serial-device", mirrors bleDeviceStore); requestPort() stays
  only in the gesture path. Type additions: getPorts(), getInfo().
- **BrowserGeolocationProvider**: no core (nothing to re-establish). Nav-11:
  PERMISSION_DENIED → stop watch+poll, connected=false, connectionLog +
  notice "Location permission denied"; transient TIMEOUT/UNAVAILABLE stay
  warn-only.
- **BLE providers**: keep everything from 93a41cb; lose only the mechanical
  state machine; public APIs unchanged.
- CapacitorGPSProvider, SimulatorProvider: untouched.

## Notice/banner generalization

`BleNotice` → `ProviderNotice` in new `src/navigation/ProviderNotice.ts`
(keep `BleNotice` re-export during migration). main.ts `handleBleNotice` →
`makeProviderNoticeHandler(bannerPrefix)`; BLE keeps its literal `ble-*`
banner ids (sacred path); others get `signalk-*`, `web-serial-*`,
`browser-gps-*`. Provider-switch cleanup generalizes via a shown-ids set.
`NavigationDataProvider` interface needs NO changes (isReconnecting/reconnect
already optional); Settings gpsLink Reconnect/Reset start working for
SK/WebSerial automatically.

## NMEA midnight fix (Nav-3) — LANDED (see git log)

parseTime(hhmmss, ddmmyy?, nowMs?): RMC date field authoritative; GGA path
resolves to nearest day (±24h to minimize |t−now|). RMC+GGA epoch-merge
coherence holds (both resolve identically when receiver clock within 12h of
wall clock). Tests: 4 midnight cases + merge-across-midnight in nmea-stream.

## Item 7 native changes

- **iOS (8b-1):** `applyPassive()` sets `manager.distanceFilter = 15` m
  (restore kCLDistanceFilterNone in applyActive). desiredAccuracy stays Best
  (30m backstop rules out coarse tiers). Duty-cycled stop/start NOT
  implemented: with no active request iOS suspends the app and the restart
  timer dies; SLC keepalive has poor at-anchor wake guarantees. Document in
  a comment; follow-up experiment: NearestTenMeters in passive after field
  measurement. Note distanceFilter thins *delivery* (app wakeups) — chip may
  stay warm; that residual is the follow-up's target. Check applyActive/
  applyPassive thread (DispatchQueue.main if needed, match startTracking).
- **Android (8b-2):** new pure `WatchdogBackoff.kt` (delays 90s, 5m, 10m,
  15m cap; onKickFruitless/reset), JVM-tested. Service: armWatchdog uses
  nextDelayMs(); accepted fix → reset; fruitless kick → onKickFruitless;
  mode flip → reset; DiagLog "watchdog armed Xms". Worst-case duty cycle
  40% → 6.7%.

## Visibility/power boundary (8b-3, 8b-10)

- `NavigationDataManager.setVisible(visible)` (injected, DOM-free): effective
  force-fast = screenWantsFast && visible; on change re-hint provider
  interval. Deliberately NOT hard-clamping to slow while hidden — adaptive
  keeps fast during maneuvers (track fidelity), yields 3s/10s when steady/
  stationary (matches Android native passive design).
- main.ts: visibilitychange → setVisible; map-update subscriber gains
  first-line `if (document.visibilityState === "hidden") return;` (recorder
  path untouched); on visible: appliedCourse=null + one immediate update.
- BLE pacing: `setReconnectPacing(relaxed)` where relaxed = hidden &&
  !recording (recording exempted — Eric's overnight case keeps full
  aggressiveness). Watchdog-only-while-connected comes free from the core.

## Test plan

New: ReconnectingTransport.test.ts (8 cases: backoff sequence/cap/reset,
silence watchdog, no-tick-while-disconnected, Nav-5 teardown, escalate
suppresses timer, suspend/resume, relaxed pacing); SignalKProvider.test.ts
extensions (close-race, server-restart reconnect, half-open watchdog, period
re-subscribe, notices); WebSerialNMEAProvider.test.ts (5 cases);
BrowserGeolocationProvider.test.ts (3); NavigationDataManager.test.ts
visibility cases; WatchdogBackoffTest.kt.
Survive UNMODIFIED: both BLE test files, SignalKProvider integration tests,
nmea tests, ConnectionEventLog, bleDeviceStore, GpsPowerManager,
AdaptiveRate, SteadinessTrackerTest.kt.

## Implementation sequence

1. ~~NMEA midnight fix (Nav-3)~~ **landed**
2. ~~Geolocation permission surfacing + ProviderNotice generalization (Nav-11)~~ **landed**
3. Extract ReconnectingTransport; migrate both BLE providers (Nav-15, Nav-5,
   8b-10 watchdog gating). BLE tests untouched. THE risky one — isolated.
4. Signal K reconnect + close race + period hint (Nav-1, -2, 8b-4)
5. Web Serial unplug recovery (Nav-4)
6. Visibility-aware tier + hidden subscriber gate + pacing wiring (8b-3)
7. Android watchdog backoff (8b-2) — independent, can land anytime
8. iOS passive distanceFilter (8b-1) — independent, can land anytime

## Risk table (abridged)

- BLE extraction regression: CRITICAL — mitigations above (composition,
  unmodified tests, isolated commit, manual smoke).
- Relaxed pacing delays recovery: only when hidden AND not recording;
  visible → immediate requestRetry.
- Hidden un-forcing thins tracks: adaptive keeps fast during maneuvers;
  flag for field validation.
- Android backoff misses recovery for up to 15 min: any accepted fix resets;
  foreground applyMode resets to 90s.
- iOS distanceFilter hides anchor drift: 15m < 30m accuracy gate and swing
  radius; anchor-drag feature planned around a different mechanism.
