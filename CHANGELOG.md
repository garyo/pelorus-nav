# Changelog

Notable user-facing changes to Pelorus Nav. Downloads are on the
[GitHub releases page](https://github.com/garyo/pelorus-nav/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.10.0] - 2026-07-06

### Added
- Crew Overboard (COB) button: hold the red life-ring button for 1.5 seconds
  to instantly mark the spot, sound an alarm, and start navigating back.
  Shows big coordinates for a mayday call, elapsed time, and bearing/distance
  to the person in the water; keeps the screen awake, records your track,
  and survives an app restart. Ending the emergency always requires a
  deliberate press-and-hold, and the COB waypoint is kept as a record.
- Volume-key chart controls (Android, optional): turn on "Volume keys zoom
  chart" in Settings to zoom the chart with the device's volume buttons —
  handy on large e-ink devices. This also adds a "Lock screen" item to the menu
  that disables the touchscreen (with an on-screen indicator) so accidental
  taps are ignored under way; press a volume button to unlock.
- After an update, a one-time "What's New" dialog summarizes the release's
  changes, with a link to the full changelog.
- Waypoints auto-named from charted features now get shorter, tidier names
  (for example, long buoy names are abbreviated).

### Changed
- Bigger, cleaner instrument readouts in landscape on small screens.
- The side instrument panel no longer covers the on-map buttons.
- Recorded tracks are now named "Pelorus Track" with the date and time, so
  exported and shared files are easier to identify.
- Exported track (GPX) files are smaller, with sensible coordinate and
  speed precision instead of long strings of meaningless digits.
- When you're offline, wind barbs now say "needs Internet connectivity"
  instead of showing a rate-limit error.

### Fixed
- The map no longer occasionally keeps zooming all the way out on its own
  after a pinch gesture (iOS).
- Fixed a rare crash when switching chart theme or region while navigating.
- The Waypoints list now updates immediately when a waypoint is added,
  removed, or renamed while the panel is open — previously it could show
  stale entries until you closed and reopened it.
- The About and What's New dialogs are now high-contrast (black-on-white) on
  e-ink displays.

## [0.9.0] - 2026-07-05

### Added
- Anchorage-area and traffic-separation-scheme chart symbols.

### Fixed
- Deleting a route or waypoint now stops any active navigation to it.
- More reliable reconnection for Bluetooth, NMEA, and Signal K instruments.
- The app no longer reloads for an update while you're actively navigating.
- Wind barbs update more reliably and use less data.
- Charts keep refreshing smoothly while underway.
- Fixed track-recording glitches when switching between tracks.
- Routes stay correctly dimmed in night mode.
