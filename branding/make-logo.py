#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools", "uharfbuzz"]
# ///
"""Generate the Pelorus Nav brand assets.

The emblem is the "sail-dart": a heeled, two-tone sail that also reads as the
GPS position arrow, riding a wave — abstract, slightly whimsical, marine.
Derived from public/icon.svg per the 2026-07-10 design feedback (no compass
rose, no red accent).

Outputs (all in this directory):
  pelorus-nav-logo.svg           1200x630 card lockup (emblem + wordmark)
  pelorus-nav-emblem.svg         square emblem in a sea-blue disc (= public/icon.svg)
  pelorus-nav-emblem-mono.svg    single-colour emblem, transparent background
  pelorus-nav-appicon-fg.svg     Android adaptive-icon foreground (transparent,
                                 mark scaled into the launcher safe zone)
  pelorus-nav-appicon-square.svg full-bleed square (iOS app icon)

Wordmark text is converted to actual vector paths (Outfit, OFL-licensed, in
fonts/) so the SVGs render identically everywhere with no font installed.

Run with:  uv run make-logo.py
Render PNGs with rsvg-convert (see README.md).
"""
import math
import os
from io import BytesIO

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "fonts", "Outfit[wght].ttf")

# ---------------------------------------------------------------- palette
NAVY_TOP = "#12203a"     # card background radial-gradient centre
NAVY_BOT = "#0a1526"     # card background radial-gradient edge
SEA = "#1a5276"          # disc fill; primary brand blue
BLUE = "#2980b9"         # disc stroke; mid accent
LIGHTBLUE = "#85c1e9"    # wave + "Nav" accent
OFFWHITE = "#eef4f7"     # lit sail panel + text on dark
SHADED = "#a9c6dc"       # shaded sail panel (jib side)
RING = "#3d6d94"         # tagline / muted chrome


# ---------------------------------------------------------------- wordmark
def text_to_path(text, size, weight, tracking=0.0):
    """Shape `text` with HarfBuzz and return (svg_path_d, width_px).

    Origin is the left end of the baseline, y-down, scaled so the font's em
    equals `size` px. `tracking` adds letterspacing (px per gap).
    """
    raw = open(FONT, "rb").read()

    vf = TTFont(BytesIO(raw))
    if "fvar" in vf:
        instantiateVariableFont(vf, {"wght": weight}, inplace=True)
    scale = size / vf["head"].unitsPerEm
    glyph_set = vf.getGlyphSet()
    glyph_order = vf.getGlyphOrder()

    face = hb.Face(raw)
    font = hb.Font(face)
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)

    track_units = tracking / scale
    parts = []
    x = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(glyph_set)
        t = Transform(scale, 0, 0, -scale, (x + pos.x_offset) * scale, -pos.y_offset * scale)
        glyph_set[glyph_order[info.codepoint]].draw(TransformPen(pen, t))
        if cmds := pen.getCommands():
            parts.append(cmds)
        x += pos.x_advance + track_units
    if text:
        x -= track_units
    return " ".join(parts), x * scale


# ---------------------------------------------------------------- emblem
# Geometry lives in a 100x100 box; scale/translate via <g transform> to place.
HEEL = 10                # degrees of heel — the boat is under way
PIVOT = (50, 42)

# sail-dart control net (upright, before heel)
T = (50, 11)             # masthead / arrow tip
R = (66.5, 60)           # clew (right base point)
L = (34, 60)             # left base point
N = (50, 45.5)           # base notch (makes it a position dart)
C_TR = (62.5, 31)        # leech: bulge outward like a full main
C_RN = (58, 52)          # base right, concave up
C_NL = (42, 52)          # base left, concave up
C_LT = (41, 32)          # luff: swept in

WAVE = "M 13 70 Q 25 62.5 37 67 Q 51 72.5 62 68 Q 74 63.5 87 66.5"
WAKE = "M 17 77 Q 25 73 33 75"


def _rot(p, deg=HEEL, c=PIVOT):
    a = math.radians(deg)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a),
            c[1] + x * math.sin(a) + y * math.cos(a))


def _f(p):
    return f"{p[0]:.2f} {p[1]:.2f}"


def emblem(mono=None):
    """The sail-dart + wave as SVG elements in the 100x100 box.

    mono: if a colour string, render everything single-colour (silhouette).
    """
    p = {k: _rot(v) for k, v in
         dict(T=T, R=R, L=L, N=N, cTR=C_TR, cRN=C_RN, cNL=C_NL, cLT=C_LT).items()}
    wave_col, wake_col = (mono, mono) if mono else (LIGHTBLUE, LIGHTBLUE)
    if mono:
        dart = (f'<path d="M {_f(p["T"])} Q {_f(p["cTR"])} {_f(p["R"])} '
                f'Q {_f(p["cRN"])} {_f(p["N"])} Q {_f(p["cNL"])} {_f(p["L"])} '
                f'Q {_f(p["cLT"])} {_f(p["T"])} Z" fill="{mono}"/>')
    else:
        right = (f'M {_f(p["T"])} Q {_f(p["cTR"])} {_f(p["R"])} '
                 f'Q {_f(p["cRN"])} {_f(p["N"])} Z')
        left = (f'M {_f(p["T"])} L {_f(p["N"])} '
                f'Q {_f(p["cNL"])} {_f(p["L"])} Q {_f(p["cLT"])} {_f(p["T"])} Z')
        # big panel (main) lit, narrow leading panel (jib) shaded
        dart = (f'<path d="{left}" fill="{OFFWHITE}"/>\n'
                f'  <path d="{right}" fill="{SHADED}"/>')
    return f'''{dart}
  <path d="{WAVE}" fill="none" stroke="{wave_col}" stroke-width="4.5" stroke-linecap="round"/>
  <path d="{WAKE}" fill="none" stroke="{wake_col}" stroke-width="3" stroke-linecap="round" opacity="0.55"/>'''


def write(name, content):
    path = os.path.join(HERE, name)
    with open(path, "w") as fh:
        fh.write(content)
    print("wrote", path)


# ---------------------------------------------------------------- square emblem
write("pelorus-nav-emblem.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="{SEA}" stroke="{BLUE}" stroke-width="3"/>
  {emblem()}
</svg>
''')

write("pelorus-nav-emblem-mono.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  {emblem(mono=OFFWHITE)}
</svg>
''')

# Android adaptive-icon foreground: mark only, shrunk so it survives the
# launcher mask (safe zone is the central ~61% of the canvas).
write("pelorus-nav-appicon-fg.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(50,50) scale(0.72) translate(-50,-44.5)">
  {emblem()}
  </g>
</svg>
''')

# iOS app icon: full-bleed sea square (iOS applies its own corner mask).
write("pelorus-nav-appicon-square.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="{SEA}"/>
  <circle cx="50" cy="50" r="44" fill="none" stroke="{BLUE}" stroke-width="4"/>
  {emblem()}
</svg>
''')

# ---------------------------------------------------------------- card lockup
W, H = 1200, 630

name_size = 96
d_pelorus, w_pelorus = text_to_path("Pelorus", name_size, weight=600)
d_nav, w_nav = text_to_path("Nav", name_size, weight=600)
d_full, w_full = text_to_path("Pelorus Nav", name_size, weight=600)
nav_off = w_full - w_nav                      # keeps the true space advance
name_x = (W - w_full) / 2
name_y = 528

tag_size = 27
d_tag, w_tag = text_to_path("MARINE CHARTPLOTTER", tag_size, weight=500, tracking=9)
tag_x = (W - w_tag) / 2
tag_y = 580

# emblem placement: 100-box scaled up, centred above the wordmark
E_SCALE = 3.7
E_TX = W / 2 - 50 * E_SCALE
E_TY = 212 - 44 * E_SCALE

write("pelorus-nav-logo.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="{NAVY_TOP}"/>
      <stop offset="100%" stop-color="{NAVY_BOT}"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect width="{W}" height="{H}" fill="url(#bg)"/>

  <!-- sail-dart emblem -->
  <g transform="translate({E_TX:.1f},{E_TY:.1f}) scale({E_SCALE})" filter="url(#soft)">
  {emblem()}
  </g>

  <!-- wordmark: Pelorus Nav (Outfit 600, as paths) -->
  <g transform="translate({name_x:.1f},{name_y})">
    <path d="{d_pelorus}" fill="{OFFWHITE}"/>
    <path transform="translate({nav_off:.1f},0)" d="{d_nav}" fill="{LIGHTBLUE}"/>
  </g>

  <!-- tagline -->
  <path transform="translate({tag_x:.1f},{tag_y})" d="{d_tag}" fill="{RING}"/>
</svg>
''')

print()
print("render PNGs:")
print("  rsvg-convert -w 1200 -h 630 pelorus-nav-logo.svg -o pelorus-nav-logo.png")
print("  rsvg-convert -w 512 -h 512 pelorus-nav-emblem.svg -o pelorus-nav-emblem.png")
