#!/usr/bin/env bun
/**
 * Fuzz route auto-advance (waypointPassNM): random routes sailed by a
 * simulated helmsman with random habits — corner cutting, offset lanes,
 * overshoots, circling short of a waypoint, departures headed the wrong way,
 * sparse noisy fixes — judged with the abeam line alone and with the full
 * rule (abeam or course-gated turn), on the same fixes.
 *
 *   bun tools/waypoint-passing-fuzz.ts [count] [seed] [report.html]
 *
 * Prints how many scenarios each rule gets flagged in:
 *   depart         advanced while leaving the start headed away from the route
 *   loiter         advanced while circling short of the waypoint
 *   early          advanced with the waypoint within 45° of the bow, > 0.25 NM off
 *   ahead-of-helm  advanced while the helmsman still steered for the waypoint
 *   astern>60s     the target stayed > 100° off the bow for over a minute
 *   stuck          a leg never advanced (sailed past the end of the route)
 * "astern" is the old rule's failing by construction; weigh the others.
 * The HTML report draws up to 60 scenarios, flagged ones first.
 * DIAG=<flag> also buckets the full rule's cases of that flag by turn angle.
 */

import { mulberry32 } from "../src/navigation/route-join-scenarios";
import {
  type LatLon,
  waypointPassNM,
} from "../src/navigation/waypoint-passing";
import {
  haversineDistanceNM,
  initialBearingDeg,
} from "../src/utils/coordinates";

const COUNT = Number(process.argv[2] ?? 3000);
const SEED = Number(process.argv[3] ?? 1027);
const REPORT = process.argv[4];

const ORIGIN_LAT = 42.3;
const ORIGIN_LON = -70.9;
const COS_LAT = Math.cos((ORIGIN_LAT * Math.PI) / 180);
const ARRIVAL_NM = 0.1;

/** NM east / north of the origin. */
interface P {
  x: number;
  y: number;
}
const toLatLon = (p: P): LatLon => ({
  lat: ORIGIN_LAT + p.y / 60,
  lon: ORIGIN_LON + p.x / (60 * COS_LAT),
});

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const len = (a: P) => Math.hypot(a.x, a.y);
const unit = (a: P): P => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const brgOf = (v: P) => ((Math.atan2(v.x, v.y) * 180) / Math.PI + 360) % 360;
const wrap = (d: number) => (((d % 360) + 540) % 360) - 180;

interface Scenario {
  id: number;
  route: P[];
  speedKn: number;
  fixIntervalS: number;
  turnRateDps: number;
  /** Pure-pursuit lookahead along the leg, NM. */
  lookahead: number;
  /** Lane offset to starboard of the leg, NM (negative: to port). */
  bias: number;
  /** > 0: turns for the next leg this far short of the waypoint; < 0: overshoots. */
  cut: number;
  /** GPS noise standard deviation, NM. */
  noise: number;
  /** Circles this many times, `loiterShort` NM short of waypoint `loiterWp`. */
  loiterTurns: number;
  loiterWp: number;
  loiterShort: number;
  /** Heads this far away from the route before turning onto it, or 0. */
  departAway: number;
}

function makeScenario(id: number, rand: () => number): Scenario {
  const n = 3 + Math.floor(rand() * 6);
  const route: P[] = [{ x: 0, y: 0 }];
  let brg = rand() * 360;
  for (let i = 1; i < n; i++) {
    if (i > 1) {
      const k = rand();
      brg +=
        k < 0.05
          ? 180
          : k < 0.1
            ? (rand() - 0.5) * 30
            : k < 0.8
              ? (rand() - 0.5) * 200
              : (rand() < 0.5 ? -1 : 1) * (100 + rand() * 70);
    }
    const legNM = Math.exp(Math.log(0.2) + rand() * Math.log(15)); // 0.2–3 NM
    const b = (brg * Math.PI) / 180;
    const prev = route[i - 1];
    route.push({
      x: prev.x + legNM * Math.sin(b),
      y: prev.y + legNM * Math.cos(b),
    });
  }
  if (rand() < 0.15) {
    // Out-and-back: return to the start.
    route.length = Math.min(route.length, 2 + Math.floor(rand() * 2));
    route.push({ ...route[0] });
  }
  const powerboat = rand() < 0.5;
  return {
    id,
    route,
    speedKn: powerboat ? 8 + rand() * 17 : 3 + rand() * 5,
    fixIntervalS: [1, 1, 3, 15, 20][Math.floor(rand() * 5)],
    turnRateDps: powerboat ? 3 + rand() * 10 : 1 + rand() * 4,
    lookahead: 0.02 + rand() * 0.5,
    bias: rand() < 0.5 ? 0 : (rand() - 0.5) * (rand() < 0.3 ? 0.8 : 0.2),
    cut: rand() < 0.3 ? -rand() * 0.3 : rand() * 0.5,
    noise: rand() * 0.006,
    loiterTurns: rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0,
    loiterWp: 1 + Math.floor(rand() * (n - 2)),
    loiterShort: 0.15 + rand() * 0.5,
    departAway: rand() < 0.3 ? 0.05 + rand() * 0.3 : 0,
  };
}

interface Fix {
  t: number;
  /** Reported (noisy) position. */
  p: P;
  truePos: P;
  cog: number;
  /** The leg the helmsman is steering. */
  helmLeg: number;
  loitering: boolean;
  departing: boolean;
}

/** The helmsman steers the route by pure pursuit at a limited turn rate. */
function simulate(s: Scenario, rand: () => number): Fix[] {
  const R = s.route;
  const stepNM = s.speedKn / 3600; // per 1 s step
  const gauss = () =>
    Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const away = unit(sub(R[0], R[1]));
  let departTarget: P | null =
    s.departAway > 0
      ? { x: R[0].x + away.x * s.departAway, y: R[0].y + away.y * s.departAway }
      : null;
  let pos = { ...R[0] };
  let hdg = departTarget ? brgOf(away) : brgOf(sub(R[1], R[0]));
  let leg = 1;
  let loiterLeftDeg = 0;
  let loitered = false;
  const fixes: Fix[] = [];
  const fixAt = (t: number) => ({
    t,
    p: { x: pos.x + gauss() * s.noise, y: pos.y + gauss() * s.noise },
    truePos: pos,
    cog: (hdg + gauss() * 6 + 360) % 360,
    helmLeg: leg,
  });
  for (let t = 1, nextFix = 0; t <= 6 * 3600; t++) {
    const a = R[leg - 1];
    const b = R[leg];
    const d = unit(sub(b, a));
    const legNM = len(sub(b, a));
    const along = dot(sub(pos, a), d);
    const isLast = leg === R.length - 1;
    if (!isLast && along >= legNM - Math.min(s.cut, legNM / 2)) {
      leg++;
      t--;
      continue;
    }
    if (isLast && len(sub(b, pos)) < 0.03) {
      // Stopped at the end: the next fix finds the vessel here.
      fixes.push({ ...fixAt(t), loitering: false, departing: false });
      break;
    }
    if (
      !loitered &&
      s.loiterTurns > 0 &&
      leg === s.loiterWp &&
      along >= legNM - Math.min(s.loiterShort, legNM * 0.8)
    ) {
      loitered = true;
      loiterLeftDeg = s.loiterTurns * 360;
    }
    // Aim at a point ahead on the leg (extended past its end), offset by the lane.
    const look = Math.max(
      Math.min(along + s.lookahead, isLast ? legNM : legNM + 2),
      0,
    );
    const bias = isLast && legNM - along < 0.3 ? 0 : s.bias;
    const aim = {
      x: a.x + d.x * look + d.y * bias,
      y: a.y + d.y * look - d.x * bias,
    };
    if (departTarget && len(sub(departTarget, pos)) < 0.02) departTarget = null;
    if (loiterLeftDeg > 0) {
      hdg = (hdg + s.turnRateDps) % 360;
      loiterLeftDeg -= s.turnRateDps;
    } else {
      const dh = wrap(brgOf(sub(departTarget ?? aim, pos)) - hdg);
      hdg =
        (hdg + Math.max(-s.turnRateDps, Math.min(s.turnRateDps, dh)) + 360) %
        360;
    }
    const h = (hdg * Math.PI) / 180;
    pos = { x: pos.x + stepNM * Math.sin(h), y: pos.y + stepNM * Math.cos(h) };
    if (t >= nextFix) {
      fixes.push({
        ...fixAt(t),
        loitering: loiterLeftDeg > 0 || departTarget !== null,
        departing: departTarget !== null,
      });
      nextFix += s.fixIntervalS;
    }
  }
  return fixes;
}

/** Course over ground, or null for the abeam line alone. */
type CourseOf = (f: Fix) => number | null;

interface Advance {
  wp: number;
  t: number;
  dist: number;
  /** The waypoint's angle off the bow (0 ahead, 180 astern). */
  offBow: number;
  helmLeg: number;
  p: P;
  loitering: boolean;
  departing: boolean;
}

interface RunResult {
  advances: Advance[];
  /** Per waypoint: seconds it stayed the target while > 100° off the bow. */
  astern: number[];
  stuckAt: number | null;
}

/** Steps route navigation over the fixes as ActiveNavigationManager does. */
function run(s: Scenario, fixes: Fix[], courseOf: CourseOf): RunResult {
  const R = s.route.map(toLatLon);
  const advances: Advance[] = [];
  const astern: number[] = new Array(R.length).fill(0);
  let leg = 1;
  let lastT = 0;
  for (const f of fixes) {
    const v = toLatLon(f.p);
    const wp = R[leg];
    const dist = haversineDistanceNM(v.lat, v.lon, wp.lat, wp.lon);
    const offBow = Math.abs(
      wrap(initialBearingDeg(v.lat, v.lon, wp.lat, wp.lon) - f.cog),
    );
    if (offBow > 100) astern[leg] += f.t - lastT;
    lastT = f.t;
    const isLast = leg === R.length - 1;
    const passed =
      !isLast &&
      waypointPassNM(v.lat, v.lon, courseOf(f), R[leg - 1], wp, R[leg + 1]) >=
        0;
    if (dist < ARRIVAL_NM || passed) {
      const { t, p, helmLeg, loitering, departing } = f;
      advances.push({
        wp: leg,
        t,
        dist,
        offBow,
        helmLeg,
        p,
        loitering,
        departing,
      });
      if (isLast) return { advances, astern, stuckAt: null };
      leg++;
    }
  }
  return { advances, astern, stuckAt: leg };
}

const FLAGS = [
  "depart",
  "loiter",
  "early",
  "ahead-of-helm",
  "astern>60s",
  "stuck",
] as const;

interface Flag {
  kind: (typeof FLAGS)[number];
  wp: number;
  detail: string;
}

function judge(s: Scenario, res: RunResult): Flag[] {
  const flags: Flag[] = [];
  for (const a of res.advances) {
    const where = `${a.dist.toFixed(2)} NM off, ${a.offBow.toFixed(0)}° off bow`;
    if (a.dist > ARRIVAL_NM && (a.departing || a.loitering))
      flags.push({
        kind: a.departing ? "depart" : "loiter",
        wp: a.wp,
        detail: where,
      });
    if (a.offBow < 45 && a.dist > 0.25 && a.dist > 2 * Math.abs(s.bias))
      flags.push({
        kind: "early",
        wp: a.wp,
        detail: `${where}, helm on leg ${a.helmLeg}`,
      });
    if (a.helmLeg <= a.wp && a.offBow < 80 && a.dist > ARRIVAL_NM)
      flags.push({ kind: "ahead-of-helm", wp: a.wp, detail: where });
  }
  for (let i = 1; i < s.route.length - 1; i++) {
    if (res.astern[i] > 60)
      flags.push({
        kind: "astern>60s",
        wp: i,
        detail: `${res.astern[i].toFixed(0)} s abaft the beam as target`,
      });
  }
  if (res.stuckAt !== null)
    flags.push({ kind: "stuck", wp: res.stuckAt, detail: "never advanced" });
  return flags;
}

interface Row {
  s: Scenario;
  fixes: Fix[];
  old: RunResult;
  neu: RunResult;
  flagsOld: Flag[];
  flagsNew: Flag[];
}

const rand = mulberry32(SEED);
const rows: Row[] = [];
for (let i = 0; i < COUNT; i++) {
  const s = makeScenario(i, rand);
  const fixes = simulate(s, rand);
  const old = run(s, fixes, () => null);
  const neu = run(s, fixes, (f) => f.cog);
  rows.push({
    s,
    fixes,
    old,
    neu,
    flagsOld: judge(s, old),
    flagsNew: judge(s, neu),
  });
}

const flagged = (kind: Flag["kind"], pick: (r: Row) => Flag[]) =>
  rows.filter((r) => pick(r).some((f) => f.kind === kind)).length;
const interior = rows.reduce((n, r) => n + r.s.route.length - 2, 0);
console.log(`${COUNT} scenarios, ${interior} interior waypoints, seed ${SEED}`);
console.log("scenarios flagged    abeam   full");
for (const k of FLAGS)
  console.log(
    `  ${k.padEnd(16)} ${String(flagged(k, (r) => r.flagsOld)).padStart(6)} ${String(flagged(k, (r) => r.flagsNew)).padStart(6)}`,
  );

/** Off-bow angle at interior advances outside the arrival radius, 30° bins. */
function offBowHistogram(pick: (r: Row) => RunResult): number[] {
  const bins: number[] = new Array(7).fill(0);
  for (const row of rows)
    for (const a of pick(row).advances)
      if (a.wp < row.s.route.length - 1 && a.dist >= ARRIVAL_NM)
        bins[Math.min(6, Math.floor(a.offBow / 30))]++;
  return bins;
}
console.log("off bow at a pass (0–30°, 30–60°, …, 180°):");
console.log("  abeam", offBowHistogram((r) => r.old).join(" "));
console.log("  full ", offBowHistogram((r) => r.neu).join(" "));

const diag = process.env.DIAG;
if (diag) {
  const turnAt = (route: P[], i: number) =>
    wrap(
      brgOf(sub(route[i + 1], route[i])) - brgOf(sub(route[i], route[i - 1])),
    );
  const buckets: Record<string, number> = {};
  const samples: string[] = [];
  for (const row of rows)
    for (const f of row.flagsNew.filter((f) => f.kind === diag)) {
      const R = row.s.route;
      if (f.wp >= R.length - 1) {
        buckets["last wp"] = (buckets["last wp"] ?? 0) + 1;
        continue;
      }
      const turn = turnAt(R, f.wp);
      const k =
        Math.abs(turn) < 90
          ? "<90°"
          : Math.abs(turn) < 135
            ? "90–135°"
            : "135°+";
      buckets[k] = (buckets[k] ?? 0) + 1;
      if (samples.length < 25)
        samples.push(
          `#${row.s.id} wp${f.wp} turn ${turn.toFixed(0)}° cut ${row.s.cut.toFixed(2)} bias ${row.s.bias.toFixed(2)} legIn ${len(sub(R[f.wp], R[f.wp - 1])).toFixed(2)} | ${f.detail}`,
        );
    }
  console.log(diag, buckets);
  console.log(samples.join("\n"));
}

if (REPORT) {
  const picked = [
    ...rows.filter((r) => r.flagsNew.length > 0),
    ...rows
      .filter((r) => r.flagsNew.length === 0 && r.flagsOld.length > 0)
      .slice(0, 12),
    ...rows
      .filter((r) => r.flagsNew.length === 0 && r.flagsOld.length === 0)
      .slice(0, 6),
  ].slice(0, 60);
  await Bun.write(REPORT, renderHtml(picked));
  console.log(`wrote ${picked.length} scenarios to ${REPORT}`);
}

function renderHtml(sel: Row[]): string {
  const S = 300;
  const cards = sel.map((row) => {
    const pts = [...row.s.route, ...row.fixes.map((f) => f.truePos)];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const span = Math.max(maxX - minX, maxY - minY, 0.2) * 1.08;
    const X = (p: P) =>
      (((p.x - (minX + maxX) / 2) / span + 0.5) * S).toFixed(1);
    const Y = (p: P) =>
      ((0.5 - (p.y - (minY + maxY) / 2) / span) * S).toFixed(1);
    const radius = ((ARRIVAL_NM / span) * S).toFixed(1);
    const poly = (ps: P[]) => ps.map((p) => `${X(p)},${Y(p)}`).join(" ");
    const wps = row.s.route
      .map(
        (p, i) =>
          `<circle cx="${X(p)}" cy="${Y(p)}" r="${radius}" class="rad"/><text x="${X(p)}" y="${Y(p)}" class="lbl">${i}</text>`,
      )
      .join("");
    const marks = (res: RunResult, cls: string) =>
      res.advances
        .map((a) => {
          const wp = row.s.route[a.wp];
          return `<line x1="${X(a.p)}" y1="${Y(a.p)}" x2="${X(wp)}" y2="${Y(wp)}" class="${cls}"/><circle cx="${X(a.p)}" cy="${Y(a.p)}" r="3.5" class="${cls}"/>`;
        })
        .join("");
    const flags = (fl: Flag[], cls: string) =>
      fl
        .map(
          (f) =>
            `<div class="flag ${cls}">${cls} · wp${f.wp} ${f.kind}: ${f.detail}</div>`,
        )
        .join("");
    const s = row.s;
    return `<figure><svg viewBox="0 0 ${S} ${S}"><polyline points="${poly(s.route)}" class="route"/>${wps}<polyline points="${poly(row.fixes.map((f) => f.p))}" class="track"/>${marks(row.old, "abeam")}${marks(row.neu, "full")}</svg>
<figcaption>#${s.id} · ${s.speedKn.toFixed(0)} kn · fix ${s.fixIntervalS} s · turn ${s.turnRateDps.toFixed(0)}°/s · look ${s.lookahead.toFixed(2)} · bias ${s.bias.toFixed(2)} · cut ${s.cut.toFixed(2)} · noise ${(s.noise * 1852).toFixed(0)} m
${flags(row.flagsOld, "abeam")}${flags(row.flagsNew, "full")}</figcaption></figure>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Waypoint passing fuzz</title>
<style>
:root{--bg:#fff;--fg:#222;--route:#2563eb;--track:#999;--abeam:#d97706;--full:#16a34a}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#ddd;--track:#777}}
body{background:var(--bg);color:var(--fg);font:13px system-ui;margin:16px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
figure{margin:0;border:1px solid #8884;padding:8px;border-radius:6px}
svg{width:100%;height:auto;background:#8881}
.route{fill:none;stroke:var(--route);stroke-width:1.5}
.track{fill:none;stroke:var(--track);stroke-width:1}
.rad{fill:none;stroke:var(--route);stroke-dasharray:2 2;opacity:.6}
.lbl{font-size:10px;fill:var(--route)}
line.abeam{stroke:var(--abeam);stroke-width:1;stroke-dasharray:3 2} circle.abeam{fill:var(--abeam)}
line.full{stroke:var(--full);stroke-width:1} circle.full{fill:none;stroke:var(--full);stroke-width:1.5}
.flag.abeam{color:var(--abeam)} .flag.full{color:var(--full)}
</style>
<h1>Waypoint passing fuzz</h1>
<p>Blue: route (dashed circles: the 0.1 NM arrival radius). Grey: noisy fixes.
<span style="color:var(--abeam)">● abeam line only</span> ·
<span style="color:var(--full)">○ full rule</span>; each pass is joined to the waypoint passed.</p>
<main>${cards.join("\n")}</main>`;
}
