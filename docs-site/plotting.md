# Traditional Plotting

In a modern chartplotter there is rarely a *need* for the traditional
plotting tools of pencil, parallel rules, and dividers. But the old ways
are worth keeping alive — they're satisfying, they build the skills you'll
want if the electronics ever quit, and they're genuinely useful on longer
passages and when planning. So Pelorus Nav has a set of traditional
plotting tools built in.

Open them with **PLOT** in the top bar, or place a single element from the
chart context menu's **Plot ▸** submenu. The toolbar appears at the top of
the chart:

<img src="/images/plot-toolbar.png" alt="The plotting toolbar" style="max-width:360px">

Pick a tool, then tap the chart to place its element. Tapping an existing
element selects it for editing — its numbers (bearing, distance, radius,
label, text) appear as fields in the toolbar's second row, along with
**Delete**. Everything you plot is saved with the chart and stays visible
after **Done** closes the toolbar; **Clear** wipes the sheet when the
exercise is over.

## Position symbols

The four position symbols are the standard ones you'd pencil on a paper
chart, each with a time label:

- <img src="/images/icons/plot-circle.png" style="height:22px; display:inline-block; vertical-align:middle; margin:0 3px; background:#fff; border-radius:3px; padding:2px" alt="circle"> **Fix** —
  a position you're sure of: visual or radar fix, or a confirmed GPS
  position you want on the record.
- <img src="/images/icons/plot-half-circle.png" style="height:14px; display:inline-block; vertical-align:middle; margin:0 3px; background:#fff; border-radius:3px; padding:2px" alt="half circle"> **DR** (dead reckoning) —
  where you *should* be, projected from your last fix along your course
  at your speed, ignoring current and leeway.
- <img src="/images/icons/plot-square.png" style="height:22px; display:inline-block; vertical-align:middle; margin:0 3px; background:#fff; border-radius:3px; padding:2px" alt="square"> **EP** (estimated position) —
  a DR corrected by whatever partial information you have: one line of
  position, or known set and drift.
- <img src="/images/icons/plot-triangle.png" style="height:20px; display:inline-block; vertical-align:middle; margin:0 3px; background:#fff; border-radius:3px; padding:2px" alt="triangle"> **R.Fix** (running fix) —
  a fix from two bearings of the same object taken at different times,
  the first line of position advanced along your run.

## Lines, arcs, and notes

- **Brg** places a **bearing line** — a line of position through a point
  at a bearing you type (magnetic or true, e.g. `339M`). Sight a
  lighthouse over your hand-bearing compass, tap the light, enter the
  bearing: you're somewhere on that line.
- **Line ▾** offers a **free line** between two points, a **Brg/Dist
  line** (a line from a point at a typed bearing and distance), and a
  **current arrow** — the chevroned set-and-drift vector of classic
  chartwork.
- **Arc** draws a **distance arc** — a circle of position from a radar
  range or a vertical-sextant-angle distance, or a keep-clear ring around
  a hazard.
- **Text** drops a free note anywhere on the chart.

Lines and arcs label themselves with their computed magnetic bearing and
distance, so a plotted line doubles as a measurement.

## A worked example

Here's a half hour of classic chartwork in Nantasket Roads — a 1400 fix,
a DR track run out at 5 knots, and at 1430 a bearing of Deer Island Light
giving a line of position; where the LOP disagrees with the 1430 DR, an
EP square marks the better answer. A 0.4 NM danger arc rings the light,
and a current arrow with a note records the ebb the plot needs to explain
the difference:

![A worked plot: fix, DR track, bearing LOP, EP, danger arc, and current arrow](/images/plotting.png)

Every element here was placed with the toolbar in under a minute — no
parallel rules required, though we won't tell anyone if you check it
against the paper chart afterward.
