# Features

A quick tour of what Pelorus Nav does, grouped by what you'd use it for.
The links lead to the parts of this guide that cover each feature in detail.

## Charts & display

Pelorus Nav draws official NOAA electronic charts (ENC) as vector charts,
with the standard IHO S-52 symbology used by commercial chartplotters. The
charts cover US coastal waters, the Great Lakes, Puerto Rico and the US
Virgin Islands, and Hawaii (Alaska isn't covered).

- **Official NOAA vector charts** in 15 downloadable regions — see
  [The Chart Display](/chart-display) and
  [downloading charts](/getting-started#downloading-charts-for-offline-use).
- **Kept current** — NOAA's chart updates are checked nightly, and
  downloaded regions show
  [Update available](/getting-started#downloading-charts-for-offline-use)
  when a newer version is published.
- **Multi-scale quilting** — charts of different scales blend into one
  seamless chart as you zoom, with more detail appearing as you zoom in
  ([detail levels](/chart-display#detail-levels)).
- **Day, Dusk, Night, and E-ink themes** using the official S-52 color
  palettes ([display themes](/chart-display#display-themes)).
- **Adjustable detail level**, optional
  [layer groups](/chart-display#layers), and
  [chart text and icon size](/getting-started#settings-worth-changing).
- **Light sectors** and a **charted currents** layer, including the Gulf
  Stream arrows printed on offshore charts ([layers](/chart-display#layers)).
- **Depth shading** set to your boat's draft, with a safety contour and an
  optional white deep-water look
  ([settings](/getting-started#settings-worth-changing)).
- **Offline street basemap** for land detail near shore
  ([downloading charts](/getting-started#downloading-charts-for-offline-use)).
- **Follow, course-up, and north-up modes**, with a look-ahead offset that
  shows more water ahead of the boat ([chart modes](/chart-display#chart-modes)).
- **Magnetic or true bearings** throughout the app
  ([settings](/getting-started#settings-worth-changing)).
- **Your own raster charts** — satellite imagery or scanned charts loaded as
  PMTiles files; MBTiles and BSB/KAP charts can be converted on a desktop
  computer first ([Your Own Charts](/own-charts)).

## Chart tools

Tap the chart to find out what's there, find a place by name, or measure and
plot the way you would on paper.

- **Tap to identify** any charted object — buoy, light, wreck, depth area —
  and see its attributes ([identifying features](/chart-display#identifying-features)).
- **Place search** by name — harbors, islands, buoys, lights — working
  offline for downloaded regions ([finding places](/chart-display#finding-places)).
- **Go to coordinates** from search or the context menu
  ([context menu](/chart-display#the-map-context-menu)).
- **Measure range and bearing** along a path
  ([context menu](/chart-display#the-map-context-menu)).
- **Traditional plotting** — fixes, DR, EP, and running fixes; bearing lines
  (LOPs), distance arcs, current arrows, and notes
  ([Traditional Plotting](/plotting)).

## Navigation

Plan routes on a big screen or on the boat, then follow them leg by leg with
live steering guidance.

- **Routes and waypoints** — tap to build a route, drag to edit, undo,
  [snap to existing waypoints](/routes#snapping-to-existing-waypoints),
  reverse, and extend from either end ([editing a route](/routes#editing-a-route)).
- **Folders and bulk selection** for routes, waypoints, and tracks
  ([organizing with folders](/routes#organizing-with-folders)).
- **Waypoint symbols** in the shapes and colors Garmin and ActiveCaptain use,
  so imported marks keep their coding ([symbols](/chart-display#symbols)).
- **Navigate to any point** — a waypoint, or anywhere you long-press on the
  chart ([context menu](/chart-display#the-map-context-menu)).
- **Auto-advancing legs** with an arrival beep, and joining a route partway
  along ([following a route](/routes#following-a-route)).
- **Navigation instruments** — SOG, COG, VMG, bearing, steer-to, distance to
  waypoint and destination, time to go, and ETA
  ([following a route](/routes#following-a-route)).
- **Projected course line** ahead of the vessel, with time ticks
  ([following a route](/routes#following-a-route)).

![Following a route, with the navigation instruments](/images/route-navigation.png)

## Safety

- **Crew overboard (COB) button** — press and hold to drop a mark and start
  navigating back to it ([the main screen](/getting-started#the-main-screen)).
- **Anchor watch** (experimental) — a watch circle around your anchor with a
  drag alarm, GPS-lost alarm, and tide-aware scope. In the Android app it
  keeps watching with the screen off; in a browser it works only while the
  page stays open with the screen on; it isn't yet available in the iOS app
  ([Anchor Watch](/anchor-watch)).
- **GPS warnings** — a **NO GPS** badge when the fix goes stale, with speed
  and course blanked rather than left showing old values
  ([instruments](/chart-display#instruments)).
- **Touchscreen lock** so spray and stray taps can't change anything under
  way ([settings](/getting-started#settings-worth-changing)).

## Tracks

Record every outing, then replay it and see how it went.

- **Track recording** that survives app restarts, and continues in the
  background with the screen off in the Android and iOS apps
  ([recording](/tracks#recording)).
- **Track Viewer** with a speed-colored track and a speed-profile chart
  ([the Track Viewer](/tracks#the-track-viewer)).
- **Playback** at up to hundreds of times real speed.
- **Tack and jibe detection**, with each maneuver marked on the chart.
- **Stats for any stretch** — select part of the speed chart for its
  distance, time, and average and max speed.
- **Route preview** with time estimates at a planning speed
  ([the Routes panel](/routes#the-routes-panel)).
- **GPX import and export** for routes, waypoints, and tracks, with
  re-imports updating rather than duplicating
  ([export and import](/routes#export-and-import-gpx)).

![The Track Viewer](/images/track-viewer.png)

## Tides, wind & sun

Predicted conditions drawn right on the chart, up to 48 hours ahead.

- **Tide and current predictions** from NOAA stations, computed on the
  device so they work offline ([tides & currents](/environment#tides-currents)).
- **Nearest tide station** to your vessel in one tap
  ([the nearest tide station](/environment#the-nearest-tide-station)).
- **48-hour time bar** to scrub tides, currents, and wind forward
  ([the time bar](/environment#the-time-bar)).
- **Wind forecast barbs** — needs an internet connection
  ([wind](/environment#wind)).
- **Sunrise, sunset, and twilight times** for the week
  ([sun & twilight](/environment#sun-twilight-times)).

![A current station's schedule](/images/tide-station.png)

## Offline & downloads

Once a region is downloaded, charts, tides, and place search work with no
signal at all.

- **Downloadable chart regions**, each with its size shown before you start
  ([downloading charts](/getting-started#downloading-charts-for-offline-use)).
- **Queued, resumable downloads** — interrupted downloads continue from where
  they stopped, and on Android they keep going in the background.
- **Chart update notices** — the app tells you when newer charts are ready
  for regions you've downloaded, and **Update All** refreshes several at
  once.

## GPS & devices

- **Device GPS** — the phone's or tablet's own receiver.
- **Bluetooth GPS** — Classic NMEA receivers such as the Garmin GLO 2 (in
  the Android app), and Bluetooth LE receivers.
- **USB serial GPS** in browsers that support Web Serial, such as Chrome
  and Edge on a computer.
- **Signal K** (experimental) — the boat's own GPS and heading from a
  Signal K server ([Signal K](/signal-k)).
- **Built-in simulator** that sails a boat around Boston Harbor, for
  exploring the app ashore ([settings](/getting-started#settings-worth-changing)).
- **Battery warning** for Bluetooth GPS receivers that report their battery
  level, such as the Dual XGPS150A.

## Everyday conveniences

- **Volume-key zoom** on Android
  ([settings](/getting-started#settings-worth-changing)).
- **Keep screen on** while the GPS is active.
- **Auto-recenter when idle** — open panels close and the chart returns to
  your vessel after a minute ([chart modes](/chart-display#chart-modes)).
- **In-app bug reports** — **INFO → Report a Bug…** sends a description
  along with the diagnostics needed to track the problem down.

## Platforms & principles

- **Web app** at [pelorus-nav.com/app](https://pelorus-nav.com/app) — any
  modern browser, installable to the home screen for full-screen offline use.
- **Android app** in beta, through the Play Store's closed testing or as
  the signed APK from
  [GitHub releases](https://github.com/garyo/pelorus-nav/releases).
- **iPhone and iPad** app in beta through TestFlight.
- **Free and open source** —
  [MIT-licensed on GitHub](https://github.com/garyo/pelorus-nav).
- **No account and no tracking** — your routes, tracks, and position stay
  on your device.

See [Where to get it](/#where-to-get-it) for installation details.
