# Your Own Charts

Beyond the NOAA regions in **Chart Regions**, Pelorus Nav can load chart
files you bring yourself: satellite-imagery chart collections that cruisers
share for places with poor official charts, scanned paper charts, or a copy
of one of our own chart regions that you downloaded on another computer.

Charts are loaded as **`.pmtiles`** files, a single-file map format. Most
downloadable chart collections come as `.mbtiles` or BSB/KAP files instead,
and need converting first. Conversion is a one-time job on a desktop computer;
the tools and instructions are in
[Importing Your Own Charts](https://github.com/garyo/pelorus-nav#importing-your-own-charts)
on our GitHub page.

## Loading a chart

1. Open **Chart Regions** (RGNS, under ☰ on small screens).
2. Tap **Load from File…** at the bottom of the panel.
3. Pick the `.pmtiles` file.

The chart is copied into the app's own storage, so it works offline from
then on, and the original file can be deleted. It appears in the Chart
Regions list marked **Imported**, with its size and date.

::: tip Getting a file onto a phone or tablet
The file picker shows cloud storage (Google Drive, Dropbox, iCloud on iOS)
alongside the device's own files. For a large chart (hundreds of megabytes
or more), download the file to the device first and load it from Downloads:
picking straight from cloud storage downloads the whole file inside the
picker, with no progress shown. While it's being copied in, a chart
briefly takes up twice its size on the device.
:::

## Using an imported chart

Imported charts draw like any other chart, blended in with the NOAA vector
charts. Each one's row in Chart Regions has three buttons:

- **Eye**: show or hide the chart without deleting it.
- **Crosshair**: move the map to the chart.
- **Trash**: delete it from the device.

A scanned or satellite chart only covers the zoom levels it was made for;
many cruiser collections have detail only when zoomed well in. When you're
zoomed out past a chart's range, Pelorus Nav draws the chart's outline as a
dashed magenta line instead, so you can still see where it is. Zoom in
inside the outline to see the chart itself. (The converter on GitHub can add
zoomed-out levels to a chart so it shows at every zoom.)

## Loading our own chart regions

If you have a copy of one of Pelorus Nav's own chart region or street
basemap files, loading it works just like downloading that region in the
app: the app recognizes its own files, and they appear in the list as
downloaded. That can save a large download on a boat with a slow or
expensive connection.

::: info Raster charts only
Pelorus Nav draws imported **raster** (picture) charts. Vector `.pmtiles`
files other than our own chart regions are stored but can't be displayed,
because the app has no way to know how their data should look.
:::
