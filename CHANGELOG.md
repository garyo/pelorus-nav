# Changelog

Notable user-facing changes to Pelorus Nav. Downloads are on the
[GitHub releases page](https://github.com/garyo/pelorus-nav/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.10.0] - 2026-07-05

### Added
- Waypoints auto-named from charted features now get shorter, tidier names
  (for example, long buoy names are abbreviated).

### Changed
- Bigger, cleaner instrument readouts in landscape on small screens.
- The side instrument panel no longer covers the on-map buttons.
- When you're offline, wind barbs now say "needs Internet connectivity"
  instead of showing a rate-limit error.

### Fixed
- The map no longer occasionally keeps zooming all the way out on its own
  after a pinch gesture (iOS).
- Fixed a rare crash when switching chart theme or region while navigating.

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
