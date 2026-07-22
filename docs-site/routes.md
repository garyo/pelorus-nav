# Routes

A route is an ordered list of waypoints. You plan it in advance, then follow
it leg by leg with live steering guidance.

## Creating a route

Two ways to start:

- **From the chart** — right-click / long-press where the route should begin
  and choose **Route from here**.
- **From the Routes panel** — open **Routes** (RTE), then tap **New**.

Either way you're now in edit mode: each tap on the chart appends a
waypoint. Waypoints are auto-named after nearby charted features (buoys,
lights, points) when there's one close by, so a route reads like
"Castle Is. → President Roads → Deer Is." without any typing. A dashed
preview line follows the cursor to the next tap.

Tap **Done** to save, or **Cancel** to discard. Route names default to
something sensible; double-click the name (in the Routes panel or the
route's own panel) to rename.

## Editing a route

Open **Routes**, and tap the pencil (Edit) on the route's row. The editing
toolbar appears at the top, and the route's waypoint list stays open
alongside so you can work by name or by chart:

![Editing a route — a waypoint selected](/images/route-editing.png)

While editing:

- **Add** — tap open water to append a waypoint at the end.
- **Move** — drag any waypoint.
- **Insert** — small ghost markers appear at each leg's midpoint; tap one to
  insert a waypoint there, then drag it where you want. A ghost before the
  first waypoint prepends.
- **Select** — tap a waypoint (on the chart or in the list) to select it.
  The toolbar shows its name and leg data, plus **Delete** and
  **Insert After** buttons.
- **Rename** — double-click a waypoint's name in the list.
- **Undo** — the Undo button (or Ctrl/Cmd-Z) steps back through your edits.

**Done** saves; **Cancel** abandons all changes from this session.

## The Routes panel

![The Routes panel and route detail](/images/route-manager.png)

Selecting a route in the Routes panel opens its detail panel: the full
waypoint list with each leg's bearing, distance, and cumulative distance —
a passage plan you can read off directly. The summary at the bottom zooms
the chart to the whole route.

Per-route actions: navigate, preview (zoom to it without navigating),
export GPX, edit, show/hide on the chart, and delete. Routes can be
organized into folders via the dropdown in the detail panel.

### Export and import (GPX)

The panel header's import/export buttons read and write standard GPX files,
and each route row can be exported individually. Two reasons to use them:

- **Backup** — routes live in the app's local storage on that device.
  Export All every so often and you can't lose a season's planning to a
  lost phone or a cleared browser.
- **Moving between devices** — there's no cloud sync (by design; it works
  offline). The comfortable workflow is to plan routes on a desktop with a
  big screen and mouse, Export All, then import the file on the phone or
  tablet you navigate with. GPX is the standard interchange format, so the
  same files also move routes to and from other chartplotters and apps.

## Following a route

Tap the arrow (**Navigate route**) on a route's row or detail panel. The
instrument panel grows a navigation section, and the chart highlights the
active leg:

![Navigating a route](/images/route-navigation.png)

- **Next** — the waypoint you're steering for.
- **DTW** — distance to that waypoint.
- **BRG** — bearing to it, magnetic or true per your settings.
- **VMG** — your speed *toward the waypoint*; if it goes negative you're
  sailing away from it.
- **STR** — steer indicator: how far and which way to turn to point at the
  waypoint (`0°` means dead ahead; `←15°` means come left fifteen degrees).

When you arrive at a waypoint (within the arrival radius, 0.1 NM by
default), navigation advances to the next leg automatically. To start from
a different leg — say you're joining a route halfway — open the route's
detail panel and tap the ► marker on the leg you want.

Stop navigating with the **Cancel navigation** button that appears at the
bottom-left of the chart, the route's stop button, or the Escape key.

You can also navigate directly to a single waypoint without a route: open
**Waypoints** and tap **Navigate to** on any waypoint, or drop one from the
chart's context menu first. The same navigation instruments apply.
