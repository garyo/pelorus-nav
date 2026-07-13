# Changelog

Notable user-facing changes to Pelorus Nav. Downloads are on the
[GitHub releases page](https://github.com/garyo/pelorus-nav/releases).

The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Report a Bug (About dialog): describe the problem, optionally leave your
  email, and the report — with app diagnostics attached — goes straight to
  the developer. No more hunting for an app to share a file with. Offline,
  it falls back to sharing the report as a file.
- The GPS badge now says why there's no position: "NO GPS" (no source
  connected), "NO DATA" (device connected but silent — check the device),
  or "NO FIX" (device healthy, still waiting for satellites).
- Bug reports include a live navigation snapshot (source, connection,
  data/fix ages) and, for the Pelorus GPS pod, the pod's own status
  counters — fetched over Bluetooth in a couple of seconds, skipped
  instantly if the pod doesn't answer.

### Fixed
- Streamed (not-downloaded) charts failed to load from the production
  server; downloaded charts were unaffected.

## [0.12.0] - 2026-07-13

### Added
- Route folders: file a route into a folder from its detail panel, and
  the route manager groups them under collapsible headers — handy for a
  trip's worth of daily routes. A folder's eye icon shows or hides the
  whole set on the chart, and folders survive GPX export and import.
- The demo simulator grew up (Settings → Navigation, with Simulator as
  the GPS source): choose between replaying a real recorded sail and
  following a plotted Boston Harbor route, restart it from the beginning,
  or sail a course of your own design by naming a route SIMULATOR.
  Changing the speed multiplier no longer teleports the boat, so you can
  fast-forward at 50× and drop to 1× at the interesting part.
- The About dialog links to the pelorus-nav.com website and the app's
  Terms of Use.

### Changed
- Wind barbs now end in a small downwind arrowhead instead of the
  conventional circle, so the direction the wind is blowing toward is
  unambiguous at a glance.
- In landscape, the top-bar instrument panel no longer spans the full
  screen width. It's now a compact readout box floating below the top
  bar, so the chart keeps its full width and height; while navigating,
  the waypoint readouts sit beside SOG/COG instead of on a second row.
  The digits also no longer shrink as the window gets shorter.
- New brand mark: the "sail-dart" emblem replaces the old logo on the
  app icon, splash screen, and About dialog.
- Course-over-ground smoothing now recognizes a committed turn: through
  a tack the course line sweeps around in one clean motion and settles
  within seconds, instead of slewing slowly in stages.
- pelorus-nav.com is now an introduction page with an email signup; the
  web app lives at pelorus-nav.com/app. Old bookmarks and installed PWAs
  carry over automatically.

### Fixed
- The vessel icon always draws above route lines and waypoint markers,
  never underneath them.
- Route waypoints placed near the same charted feature no longer get
  identical auto-names.

## [0.11.0] - 2026-07-10

### Added
- Bring your own charts: import raster charts (.pmtiles) with
  Chart Regions → "Load from File…" — for example the satellite chart
  collections cruisers share for waters without official coverage,
  converted with a single command (see the README). Imported charts render
  alongside the built-in charts, work offline, and can be removed anytime.
- When zoomed out past an imported chart's detail, its actual coverage is
  outlined as a dashed magenta footprint, so small local charts stay easy
  to find on the map.
- A packing tool merges a whole folder of small chart files (a typical
  country collection is 100+ tiny single-anchorage charts) into one
  importable file, so the entire collection is a single import.
- Each raster chart in Chart Regions now has a show/hide toggle — if you
  have overlapping charts for the same waters (a scanned chart and
  satellite imagery, say), pick which one draws — and a "go to" button
  that flies the map to the chart.
- Desktop: panning with the mouse now shows the center crosshair and live
  coordinates, as touch dragging always has.

### Changed
- With an offline street basemap downloaded, the world map still appears
  when you look beyond the basemap's coverage — imported charts abroad no
  longer float in empty ocean.
- Battery: when the vessel is stationary (at anchor, at the dock), the
  chart redraws only when a GPS fix arrives instead of animating
  continuously. Every real movement still draws — swinging at anchor
  stays visible.

### Fixed
- Imported charts assembled from many small patches no longer pop in and
  out while zooming — every chart stays visible at its best available
  detail.
- Choosing a region in Chart Regions no longer snaps back to your GPS
  region moments later. Sailing into a different region still switches
  automatically.
- Search, "go to", and region selection now actually take you there while
  the chart is following the vessel (follow mode used to pull the view
  straight back to the boat).
- The lock-onto-vessel button could center far from the boat after sitting
  stationary for a while (especially in a desktop browser); it now always
  centers on the live GPS position.

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
