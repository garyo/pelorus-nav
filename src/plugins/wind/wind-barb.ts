/**
 * Wind-barb glyph rendering, shared by the wind overlay (which pre-renders
 * one image per 5-kt bucket for MapLibre) and offline tooling that draws
 * example barbs for the user guide.
 */

export interface BarbImg {
  width: number;
  height: number;
  data: Uint8Array;
  pixelRatio: number;
}

/**
 * Draw a wind barb for `speed` kt. The station (plot point) is at the tile
 * centre — MapLibre's default rotation anchor — so the barb pivots about the
 * station, with the staff extending up (toward the wind source) and feathers at
 * the upwind end. White fill/stroke over a black halo for visibility. The tile
 * is sized so feathers + halo never clip; on-screen size is set by icon-size.
 */
export function barbImage(speed: number): BarbImg {
  const s = 64;
  const px = 2;
  const canvas = document.createElement("canvas");
  canvas.width = s * px;
  canvas.height = s * px;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return { width: 1, height: 1, data: new Uint8Array(4), pixelRatio: 1 };
  ctx.scale(px, px);
  ctx.translate(s / 2, s / 2); // origin = station = rotation anchor

  const botY = 0; // station end (pivot)
  const topY = -26; // upwind tip
  const lines: [number, number, number, number][] = [];
  const flags: Array<[number, number][]> = [];

  let flagN = Math.floor(speed / 50);
  let rem = speed % 50;
  let fullN = Math.floor(rem / 10);
  rem %= 10;
  const halfN = rem >= 5 ? 1 : 0;

  // Feathers sit at the upwind tip and point away from the station (toward the
  // wind source). The staff points the way the wind comes from; the downwind
  // end carries a small dart. (North wind ⇒ feathers on top, dart below.)
  // Feathers are on the right of the staff (Northern Hemisphere convention).
  let y = topY + 2; // first feather just inside the tip
  for (; flagN > 0; flagN--) {
    flags.push([
      [0, y],
      [12, y - 3],
      [0, y + 5],
    ]);
    y += 8;
  }
  // A lone half-barb is set in from the tip per convention.
  if (fullN === 0 && halfN === 1 && flags.length === 0) y += 4;
  for (; fullN > 0; fullN--) {
    lines.push([0, y, 11, y - 5]);
    y += 5;
  }
  if (halfN) lines.push([0, y, 6, y - 2.5]);
  lines.push([0, botY, 0, topY]); // staff

  // Downwind dart in place of the WMO station circle: an arrow flies WITH
  // the wind, so the tip marks where the wind is going — the circle read
  // ambiguously (a weathervane of that shape points INTO the wind). Tip 3.2
  // units downwind of the station, wings raked back, slightly concave
  // leading edges. Footprint matches the old dot + halo.
  const dart = () => {
    ctx.beginPath();
    ctx.moveTo(0, 3.2);
    ctx.quadraticCurveTo(0.7, -0.2, 2.6, -2.2);
    ctx.lineTo(0, -0.9);
    ctx.lineTo(-2.6, -2.2);
    ctx.quadraticCurveTo(-0.7, -0.2, 0, 3.2);
    ctx.closePath();
  };

  const pass = (
    lw: number,
    color: string,
    fill: boolean,
    dartHaloW: number,
  ) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [x1, y1, x2, y2] of lines) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (const tri of flags) {
      ctx.beginPath();
      ctx.moveTo(tri[0][0], tri[0][1]);
      ctx.lineTo(tri[1][0], tri[1][1]);
      ctx.lineTo(tri[2][0], tri[2][1]);
      ctx.closePath();
      if (fill) ctx.fill();
      else ctx.stroke();
    }
    dart();
    if (dartHaloW > 0) {
      ctx.lineWidth = dartHaloW;
      ctx.stroke();
    }
    ctx.fill();
  };
  pass(3.4, "rgba(0,0,0,0.85)", false, 2.2); // black halo + dart backing
  pass(1.5, "#ffffff", true, 0); // white barb + dart

  const img = ctx.getImageData(0, 0, s * px, s * px);
  return {
    width: img.width,
    height: img.height,
    data: new Uint8Array(img.data.buffer),
    pixelRatio: px,
  };
}
