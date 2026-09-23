# Signal K

[Signal K](https://signalk.org) is free software that gathers a boat's
instrument data (GPS, compass, depth, wind, AIS) from its NMEA 0183 and
NMEA 2000 networks and shares it over the boat's WiFi. It often runs on a
Raspberry Pi (OpenPlotter, Bareboat Necessities), or on a Victron Cerbo GX.
If your boat has a Signal K server, Pelorus Nav can take its position from
the boat's own GPS instead of the phone's or tablet's.

Pelorus Nav uses the server's **position**, **course and speed over
ground**, and **heading**. If the boat has only a magnetic compass, its
heading is converted to true, using the magnetic variation from the server
or else the variation printed on the chart for your position.

::: warning Android and iOS apps only
Signal K servers on boats almost always use a plain, unencrypted connection,
and web browsers won't make one from a secure web page like
pelorus-nav.com. Use the Android or iOS app with Signal K; the web version
can only connect to a server set up for secure (`wss://`) connections.
:::

## Connecting

1. Join the boat's WiFi network, the one the Signal K server is on.
2. In **Settings → Navigation**, set **GPS source** to **Signal K**.
3. In **Signal K server**, type the server's address and press Enter (or
   tap outside the box).

The address is whatever you'd use to open the server's web page:
an IP address such as `192.168.1.50`, or a name such as
`openplotter.local`. Add the port after a colon if it isn't the usual
3000: `192.168.1.50:3300`. You can also paste the address of the server's
admin page straight from a browser; Pelorus Nav works out the rest.

While you're typing, the line under the box shows the full address it will
connect to when you press Enter. Once saved, a status line shows how the
connection is going:

- **✓ Connected, receiving position**: all good.
- **⟳ Connecting…**: trying for the first few seconds.
- **✕ Can't reach the server, retrying**: the address or port is wrong,
  you're on a different WiFi network, the server is off, or (on iPhone and
  iPad) Pelorus Nav hasn't been allowed onto the local network. Pelorus Nav
  keeps retrying on its own, so it reconnects once the problem is fixed.
- **⚠ Connected, but the server has no position**: the server is running
  but nothing is sending it a GPS position. See the server details below.
- **⚠ Connected, but no data is arriving**: the server isn't sending
  anything at all.

On iPhone and iPad, the first connection asks for permission to find devices
on your local network. Allow it; if you declined, turn **Local Network** on
for Pelorus Nav in the iOS Settings app.

::: tip Servers with security turned on
Pelorus Nav doesn't log in to the server. If the server has security turned
on, enable its **Allow Readonly Access** setting (in the server's admin
page, under Security) so Pelorus Nav can read the data.
:::

## Server details

**Settings → Navigation → Server details** opens a live view of what the
server is sending. It's useful when something isn't working, and interesting
when it is.

- **Server**: the server software and version, the boat's name and MMSI if
  the server knows them, the address, the connection, and how many messages
  a second are arriving. If the link has dropped and come back, it says how
  many times.
- **Used by Pelorus**: the position, course, speed and heading, each with
  its value, how many seconds old it is, and which instrument it came from
  (for example `nmea0183.GP` for a GPS on NMEA 0183, or `n2k.115` for a
  device on NMEA 2000). A green dot means fresh, amber means it hasn't
  updated for a while, and red means it has stopped or isn't sent at all.
  Heading is optional; without it, the boat symbol points along your course.
- **GPS quality**: the fix type, satellites used, HDOP (how good the
  satellite geometry is) and satellites in view, if the boat's GPS reports
  them.
- **All data from this server**: every value the server has, with its age
  and source, and how many other vessels it has heard on AIS. Values are
  shown as the server sends them, in metric units: depths in meters, speeds
  in meters per second, angles in radians.

Pelorus Nav doesn't yet show depth, wind or AIS targets from Signal K on the
chart. The full list shows what your server offers.

::: tip Two sources for the same thing
If the source shown for the position isn't the GPS you expected, the boat
may have two GPS receivers, and the server is choosing between them. The
server's own settings control which source it prefers.
:::
