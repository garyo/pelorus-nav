# Anchor Watch — Safety Review (2026-08-22)

A four-track adversarial review of the anchor-watch feature, run against the
maintainer's two ship criteria:

1. **Never miss a real drag** — or, where a failure mode cannot be prevented,
   reliably disclose it to the user.
2. **Never wake the crew repeatedly for non-events** — a nuisance alarm at
   anchor kills trust as surely as a missed one.

Four independent review passes (native service lifecycle; pure detection
logic; JS↔native sync protocol; false/nuisance-alarm inventory) each read the
full implementation and tests. Every finding below was re-verified against
the code before being accepted. This document records what was found, what
was fixed (all fixes landed 2026-08-22 with tests), and what remains open as
deliberate decisions.

## Fixed — missed-alarm class

| Finding | Fix |
|---|---|
| **Watchdog death after an announced alarm.** The anchor watchdog (sole caller of the GPS-loss check) was never re-armed once an alarm was announced, and acknowledge didn't re-arm it. Drag alarm → GPS dies → skipper taps Silence → GPS-loss undetectable for the rest of the night. Found independently by two review tracks. | `AnchorWatchDetector.watchdogDelayMs` — a pure, tested function that never answers "never" while a watch is armed; acknowledge re-arms from the deadline. |
| **Reboot killed an armed watch silently.** No boot receiver existed; a full restore at boot is not possible without background-location permission (deliberately not held). | `AnchorBootReceiver`: direct-boot-aware (armed flag mirrored to device-protected storage, since a phone that reboots at 03:00 sits locked until morning); posts an alarm-stream "ANCHOR WATCH NOT RUNNING" notification. Re-arming cancels it. |
| **Phantom (0,0) evaluation after restore.** A restored detector carried `hadFix` but no coordinates; the geometry push that reconcile always sends evaluated the placeholder as a position ~10,000 km out, able to fire a phantom drag on the first real fix. | Geometry is judged only after a real fix this process (`hasPosition`). |
| **JS-first restart dropped `hadFix`.** App relaunched before the sticky service → detector built with `hadFix=false` though the proof was on disk → GPS-loss disabled and the nothing-watching chirp re-opened for a proven watch. | Disk flag read unconditionally — safe because every disarm/stand-down clears it. |
| **Unsynchronized threading.** Capacitor invokes plugin methods on a handler thread; arm/disarm/acknowledge/external-fix mutated main-looper-confined detector and alarm state concurrently with fix/watchdog paths. | All anchor entry points funnel through the main handler (`runAnchorOnMain`), mirroring `applyMode`. |
| **Retained events dropped at cold start.** Retained Capacitor events replay on listener registration — before `restore()` re-arms the manager — and are consumed on delivery, so a pre-kill native alarm never reached the UI. | Events for a not-yet-armed manager are held and replayed in order at `reconcile()`. |
| **Stale `pendingAlarmSnap` in AnchorPanel.** A later hold could replay an hours-old alarm snapshot, closing a live alarm banner (leaving *no* alarm UI during GPS staleness) or reopening a cleared one. | The watch-snap replay discards it; it re-renders the alarm itself. |
| **NaN/out-of-range NMEA coordinates.** NaN minutes passed both range guards; a NaN distance compares as "inside the ring" — the alarm-suppressing direction. | Parser rejects non-finite and out-of-range values; checksum was already mandatory. |
| **Serial fan-out could kill the read loop.** An exception in JS notify or the native feed leaked the socket with no `disconnected` event — both feeds dead while JS showed connected. | Fan-out is exception-isolated. |
| **Cover claimed with a dead service.** `assessScreenOffCover` ignored `serviceRunning`; on a GNSS-less device a stopped service still read "covered". | A stopped service is never covered past the arming grace; new "service" advisory. |
| **Simulator fixes vouched for the boat.** Any nav fix — including the simulator — reported `noteExternalFix`, holding off (and clearing) the native GPS-loss alarm on fiction. | Simulator fixes no longer report; the keepalive beat still counts (JS is alive, just not vouching for the position). |

## Fixed — nuisance class

| Finding | Fix |
|---|---|
| **Ack erased by boundary flapping.** One fix inside the ring erased a drag acknowledgment (both detectors), so at a tide turn every later 15 s excursion re-woke the crew at full volume. | The ack stands until the boat is continuously inside for 60 s (`ANCHOR_ACK_RESET_INSIDE_MS`); genuine further drag still alarms via the +8 m re-alarm margin. |
| **One wake per Bluetooth dropout.** SPP reconnect policy lived in the WebView, which freezes ~90 s after screen-off — so every transient link drop matured into a full GPS-loss siren two minutes later. | Native reconnect-with-backoff while a watch is armed; JS wins the race when awake; disarm or a JS connect ends the loop. A GLO that truly dies still alarms once at 2 min — correct. |
| **Battery latches reset by charger flap.** Any single charging sample reset the fired-once latches: a vibrating 12 V plug at 15% = a fresh full alarm per flap. | Plugging in still silences immediately; latches reset only after 2 min sustained charging. |
| **Mute lost on process restart.** A skipper who muted a flapping watch got the next alarm at full volume after an overnight OS kill. | Muted state persists in `AnchorWatchStore` with the watch. |
| **Stale retained alarm blast on morning pickup.** A drag/GPS-loss that self-cleared overnight left its retained raise queued; the thawing WebView blasted the siren for an event hours over. | Self-clears emit a retained `anchorAlarmCleared` for every kind; JS nets the pair to silence and re-raises from its own evidence within a fix if the condition is live. |
| **Restored service ran ACTIVE @1 Hz all night.** Companion default mode + anchor wake lock after an overnight restart. | Restore forces PASSIVE when tracking isn't requested. |
| **Second alarm kind's ack could be missed.** `acknowledged` is an OR of per-kind flags; a second kind acknowledged while an earlier ack stood showed no edge — native sound kept ringing. | An alarm ending with the flag up also pushes (duplicates are no-ops). |
| **Mid-loop MediaPlayer error died silently** while the state machine believed the tone was up. | Error listener resets and re-derives the sound. |

Also landed alongside the review: the self-cleared-alarm **record notification**
("Anchor alarm: GPS signal lost / 6:52 PM — lost GPS signal, waiting for fix /
Still armed.") — silent, dismissible, capped at six timestamped events — so
overnight events always leave an explanation.

## Open — decisions, not oversights

- **Doze.** Partial wake locks don't prevent Doze; `setAndAllowWhileIdle` can
  be deferred ~9–15 min in deep idle, inflating the GPS-loss deadline and
  drag latency when nothing else holds the device awake. Options: request the
  battery-optimization exemption on arm (the anchor alarm is the canonical
  justified use), and/or move the anchor watchdog to `setAlarmClock`.
  Field tests so far have not shown deep-Doze deferral, but stock
  Pixel/Samsung will do it eventually on a still, unplugged, screen-off
  device.
- **Unbounded accuracy widening.** `effectiveRadiusM = r + (acc − 10)` has no
  cap: a chip reporting ±500 m keeps GPS-loss fed while making drag
  undetectable — blind but looking fed. A cap (e.g. accuracy > radius ⇒
  treat the fix as no-position, letting GPS-loss disclose) trades a possible
  rainy-night nuisance alarm for disclosure; needs a policy call.
- **Web/PWA honesty.** On web there is no native side: the watch dies with
  the hidden page and nothing says so. Minimum: an armed-panel advisory
  ("watch runs only while the app is on screen") + forcing the wake lock
  while armed, like COB does. Larger: call web unsupported for arming.
- **BLE pod parity.** The native serial feed covers SPP only. A GNSS-less
  tablet on the BLE ESP32 pod (or Signal K) still relies on the chirp
  backstop. Same native-feed treatment is possible with a small dedicated
  BLE subscription.
- **Notifications permission.** Arming never requests POST_NOTIFICATIONS and
  a user-blocked channel is undetected — the tone and vibration still sound
  (verified: the sound path is independent of notifications), but there is
  no full-screen wake, no Silence action, and no disclosure.
- **Deferred-announce without re-check.** A suppressed native detection is
  announced the moment the keepalive goes stale, with no confirmation
  window; a device chip whose multipath position disagrees with the app's
  (better) receiver can sound ~90 s after every screen-off. Mitigated on
  SPP boats by the native serial feed (the detector sees the good receiver
  too); residual for phone-chip-only setups.
- **Battery two-act design.** An unplugged tablet crossing 15% then 7%
  wakes the crew twice by design. Judged acceptable (the second is the
  last call before the watch dies), but it is a policy, not physics.

## What the review verified sound (highlights)

Restart adoption chain ordering; AlarmManager mechanics (clocks, PI flags,
anti-spin clamp); fused-position quarantine from the detector (GNSS-provider
+ checksummed-RMC only); keepalive boundary conditions and authority
handoff; suppression/announce orchestration; meta-alarm state machines
(walk-to-boat grace, ack semantics, re-fire rules); volume floor
never-lower/restore-if-unchanged with DND handling; single shared alarm
player (no double audio); service-demand truth table; SW idle-reload
busy-gate (never reloads out from under an armed watch); arming gates (no
silent blocked arms — the `disabled`-attribute field failure is fixed);
hold-gesture completion under rAF stall and e-ink contact drops.

## Field validation status

- Dead-man handoff (JS frozen → native detects drag, full-screen intent,
  retained-event reconcile): **field-proven** (2026-08-22 walk test).
- Native serial feed carrying a covered GNSS-less watch alone for 9+ min,
  zero false alarms: **field-proven** (2026-08-22 sit test).
- Screen-off drag with the native serial feed (siren with JS frozen, no
  screen-wake first): **pending** — the next morning's walk test.
- Renderer priority pin: **does not hold** on Samsung or BOOX (measured);
  retained as harmless. The architecture no longer depends on JS surviving
  screen-off anywhere.
