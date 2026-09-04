#!/usr/bin/env bun
/**
 * Print random route-join scenarios for review: where the vessel is, which
 * way it is going, which leg pickJoinLeg chose and why, and the per-leg
 * numbers behind the choice.
 *
 *   bun tools/route-join-scenarios.ts [seed] [count]
 *
 * The same generator backs the randomised unit tests (route-join.test.ts),
 * so a seed printed here reproduces there.
 */

import { pickJoinLeg, suggestReverse } from "../src/navigation/route-join";
import {
  describeLegs,
  mulberry32,
  randomScenario,
} from "../src/navigation/route-join-scenarios";

const seed = Number(process.argv[2] ?? 20260904);
const count = Number(process.argv[3] ?? 12);
const rand = mulberry32(seed);
const opts = { arrivalRadiusNM: 0.1 };

const nm = (deg: number) => (deg * 60).toFixed(1);
const pad = (v: string | number, w: number) => String(v).padStart(w);

console.log(
  `seed ${seed}, ${count} scenarios (positions in NM east/north of origin)\n`,
);
for (let i = 0; i < count; i++) {
  const s = randomScenario(rand);
  const choice = pickJoinLeg(s.fix, s.route, opts);
  const reverse = suggestReverse(s.fix, s.route, opts);
  const cog = s.fix.cog === null ? "stationary" : `COG ${pad(s.fix.cog, 3)}°`;
  console.log(
    `#${i + 1}  vessel (${nm(s.fix.lon)}, ${nm(s.fix.lat)}) ${cog}` +
      `  →  leg ${choice.legIndex} (${choice.reason})${reverse ? "  [suggest reverse]" : ""}`,
  );
  console.log("    leg  waypoint (E, N)     dist   brg   xtd   cone");
  for (const l of describeLegs(s)) {
    const wp = s.route.waypoints[l.leg];
    const mark = l.leg === choice.legIndex ? "▶" : " ";
    console.log(
      `  ${mark} ${pad(l.leg, 2)}  (${pad(nm(wp.lon), 5)}, ${pad(nm(wp.lat), 5)})` +
        `  ${pad(l.distToDest.toFixed(1), 5)}  ${pad(Math.round(l.brgToDest), 3)}°` +
        `  ${pad(l.xtd.toFixed(1), 5)}  ${l.inCone === null ? "  -" : l.inCone ? "yes" : " no"}`,
    );
  }
  console.log();
}
