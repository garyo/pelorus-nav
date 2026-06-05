#!/usr/bin/env bun
/**
 * Build the offline tides & currents bundle (public/tides-stations.json)
 * by crawling NOAA CO-OPS MDAPI for harmonic constituents and
 * subordinate-station offsets. ~9k API calls on a cold run (~25 min);
 * responses are cached in tools/tides/.cache/ so re-runs take seconds.
 *
 * Usage: bun tools/tides/build-bundle.ts
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import createTidePredictor from "@neaps/tide-predictor";
import type {
  CurrentRefStation,
  CurrentSubStation,
  TideRefStation,
  TideSubStation,
  TidesBundle,
} from "../../src/tides/schema.ts";
import { cacheHits, fetchCount, mdapiGet, pMap } from "./mdapi.ts";

const OUT_FILE = join(import.meta.dirname, "../../public/tides-stations.json");

// ── MDAPI response shapes (the fields we use) ─────────────────────────

interface TideStationEntry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: "R" | "S";
  reference_id: string;
}

interface CurrentStationEntry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: "H" | "S" | "W";
  currbin: number;
}

interface TideHarconResp {
  HarmonicConstituents: {
    name: string;
    amplitude: number;
    phase_GMT: number;
  }[];
}

interface CurrHarconResp {
  HarmonicConstituents: {
    binNbr: number;
    binDepth: number | null;
    constituentName: string;
    majorAmplitude: number;
    majorPhaseGMT: number;
  }[];
}

interface DatumsResp {
  datums: { name: string; value: number }[];
}

interface TideOffsetsResp {
  refStationId: string;
  heightOffsetHighTide: number | null;
  heightOffsetLowTide: number | null;
  timeOffsetHighTide: number | null;
  timeOffsetLowTide: number | null;
  heightAdjustedType: "R" | "F" | null;
}

interface CurrOffsetsResp {
  refStationId: string;
  refStationBin: number | null;
  meanFloodDir: number | null;
  meanEbbDir: number | null;
  mfcTimeAdjMin: number | null;
  sbeTimeAdjMin: number | null;
  mecTimeAdjMin: number | null;
  sbfTimeAdjMin: number | null;
  mfcAmpAdj: number | null;
  mecAmpAdj: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────

const round = (v: number, dp: number): number => Number(v.toFixed(dp));

const skipped: Record<string, string[]> = {};
function skip(reason: string, id: string): void {
  skipped[reason] ??= [];
  skipped[reason].push(id);
}

/** Intern constituent names; stations carry parallel arrays over this table. */
const constituentNames: string[] = [];
const constituentIndex = new Map<string, number>();
function intern(name: string): number {
  let i = constituentIndex.get(name);
  if (i === undefined) {
    i = constituentNames.length;
    constituentNames.push(name);
    constituentIndex.set(name, i);
  }
  return i;
}

/** Build dense amp/phase arrays from (name, amp, phase) triples. */
function denseArrays(
  rows: { name: string; amp: number; phase: number }[],
  ampDp: number,
): { amp: number[]; phase: number[] } {
  const amp: number[] = [];
  const phase: number[] = [];
  for (const r of rows) {
    if (r.amp === 0) continue;
    const i = intern(r.name);
    while (amp.length <= i) {
      amp.push(0);
      phase.push(0);
    }
    amp[i] = round(r.amp, ampDp);
    phase[i] = round(r.phase, 1);
  }
  return { amp, phase };
}

// ── Crawl: tide stations ──────────────────────────────────────────────

async function crawlTides(): Promise<{
  tideRef: TideRefStation[];
  tideSub: TideSubStation[];
}> {
  const list = await mdapiGet<{ count: number; stations: TideStationEntry[] }>(
    "stations.json?type=tidepredictions",
  );
  if (!list) throw new Error("tide station list unavailable");
  console.log(`Tide stations: ${list.count}`);

  const refs = list.stations.filter((s) => s.type === "R");
  const subs = list.stations.filter((s) => s.type === "S");

  const tideRef = (
    await pMap(refs, async (s): Promise<TideRefStation | null> => {
      const harcon = await mdapiGet<TideHarconResp>(
        `stations/${s.id}/harcon.json?units=metric`,
      );
      if (!harcon?.HarmonicConstituents?.length) {
        skip("tide ref: no constituents", s.id);
        return null;
      }
      const datums = await mdapiGet<DatumsResp>(
        `stations/${s.id}/datums.json?units=metric`,
      );
      const dv = new Map(datums?.datums?.map((d) => [d.name, d.value]) ?? []);
      const msl = dv.get("MSL") ?? dv.get("MTL");
      const mllw = dv.get("MLLW");
      if (msl === undefined || mllw === undefined) {
        skip("tide ref: no MSL/MLLW datum", s.id);
        return null;
      }
      const { amp, phase } = denseArrays(
        harcon.HarmonicConstituents.map((c) => ({
          name: c.name,
          amp: c.amplitude,
          phase: c.phase_GMT,
        })),
        3,
      );
      return {
        id: s.id,
        name: s.name,
        lat: round(s.lat, 5),
        lng: round(s.lng, 5),
        datum: round(msl - mllw, 3),
        amp,
        phase,
      };
    })
  ).filter((s) => s !== null);

  const refIds = new Set(tideRef.map((s) => s.id));
  const tideSub = (
    await pMap(subs, async (s): Promise<TideSubStation | null> => {
      const o = await mdapiGet<TideOffsetsResp>(
        `stations/${s.id}/tidepredoffsets.json?units=metric`,
      );
      if (
        !o ||
        o.timeOffsetHighTide == null ||
        o.timeOffsetLowTide == null ||
        o.heightOffsetHighTide == null ||
        o.heightOffsetLowTide == null ||
        (o.heightAdjustedType !== "R" && o.heightAdjustedType !== "F")
      ) {
        skip("tide sub: incomplete offsets", s.id);
        return null;
      }
      if (!refIds.has(o.refStationId)) {
        skip("tide sub: unknown reference", s.id);
        return null;
      }
      return {
        id: s.id,
        name: s.name,
        lat: round(s.lat, 5),
        lng: round(s.lng, 5),
        refId: o.refStationId,
        tHigh: o.timeOffsetHighTide,
        tLow: o.timeOffsetLowTide,
        hHigh: round(o.heightOffsetHighTide, 3),
        hLow: round(o.heightOffsetLowTide, 3),
        hAdjType: o.heightAdjustedType,
      };
    })
  ).filter((s) => s !== null);

  return { tideRef, tideSub };
}

// ── Crawl: current stations ───────────────────────────────────────────

async function crawlCurrents(): Promise<{
  currentRef: CurrentRefStation[];
  currentSub: CurrentSubStation[];
}> {
  const list = await mdapiGet<{
    count: number;
    stations: CurrentStationEntry[];
  }>("stations.json?type=currentpredictions");
  if (!list) throw new Error("current station list unavailable");
  console.log(`Current station entries: ${list.count}`);

  // Harmonic ("H") station ids; "W" (weak & variable) have no predictions.
  const hIds = new Set(
    list.stations.filter((s) => s.type === "H").map((s) => s.id),
  );

  // Subordinates: one entry per (id, bin); fetch offsets, then keep one
  // bin per station id (predictions are bin-specific but we draw one arrow).
  const sEntries = list.stations.filter((s) => s.type === "S");
  const subRecords = (
    await pMap(sEntries, async (s) => {
      const o = await mdapiGet<CurrOffsetsResp>(
        `stations/${s.id}_${s.currbin}/currentpredictionoffsets.json`,
      );
      if (
        !o ||
        !o.refStationId ||
        o.refStationBin == null ||
        o.meanFloodDir == null ||
        o.meanEbbDir == null ||
        o.mfcTimeAdjMin == null ||
        o.sbeTimeAdjMin == null ||
        o.mecTimeAdjMin == null ||
        o.sbfTimeAdjMin == null ||
        o.mfcAmpAdj == null ||
        o.mecAmpAdj == null
      ) {
        skip("current sub: incomplete offsets", `${s.id}_${s.currbin}`);
        return null;
      }
      if (!hIds.has(o.refStationId)) {
        skip("current sub: unknown reference", `${s.id}_${s.currbin}`);
        return null;
      }
      const station: CurrentSubStation = {
        id: s.id,
        name: s.name,
        lat: round(s.lat, 5),
        lng: round(s.lng, 5),
        refId: o.refStationId,
        refBin: o.refStationBin,
        floodDir: o.meanFloodDir,
        ebbDir: o.meanEbbDir,
        mfcTime: o.mfcTimeAdjMin,
        sbeTime: o.sbeTimeAdjMin,
        mecTime: o.mecTimeAdjMin,
        sbfTime: o.sbfTimeAdjMin,
        mfcAmp: o.mfcAmpAdj,
        mecAmp: o.mecAmpAdj,
      };
      return { bin: s.currbin, station };
    })
  ).filter((r) => r !== null);

  // Keep the lowest-numbered bin per subordinate id (surface-most).
  const subByStation = new Map<string, (typeof subRecords)[number]>();
  for (const r of subRecords) {
    const prev = subByStation.get(r.station.id);
    if (!prev || r.bin < prev.bin) subByStation.set(r.station.id, r);
  }
  const currentSub = [...subByStation.values()].map((r) => r.station);

  // Reference stations: keep the surface-most (shallowest) bin for display,
  // plus any bins subordinates point at.
  const neededBins = new Map<string, Set<number>>();
  for (const sub of currentSub) {
    let bins = neededBins.get(sub.refId);
    if (!bins) {
      bins = new Set();
      neededBins.set(sub.refId, bins);
    }
    bins.add(sub.refBin);
  }

  const hList = [...hIds];
  const hStationsById = new Map(
    list.stations.filter((s) => s.type === "H").map((s) => [s.id, s]),
  );

  const currentRef: CurrentRefStation[] = [];
  await pMap(hList, async (id) => {
    const harcon = await mdapiGet<CurrHarconResp>(`stations/${id}/harcon.json`);
    if (!harcon?.HarmonicConstituents?.length) {
      skip("current ref: no constituents", id);
      return;
    }
    const s = hStationsById.get(id);
    if (!s) return;

    // Group constituents by bin
    const byBin = new Map<number, CurrHarconResp["HarmonicConstituents"]>();
    for (const c of harcon.HarmonicConstituents) {
      let rows = byBin.get(c.binNbr);
      if (!rows) {
        rows = [];
        byBin.set(c.binNbr, rows);
      }
      rows.push(c);
    }
    const bins = [...byBin.keys()];
    if (bins.length === 0) {
      skip("current ref: no bins", id);
      return;
    }
    // Display bin: shallowest reported depth, else lowest bin number.
    const depthOf = (b: number): number =>
      byBin.get(b)?.[0]?.binDepth ?? Number.POSITIVE_INFINITY;
    const dispBin = bins.reduce((a, b) =>
      depthOf(b) < depthOf(a) || (depthOf(b) === depthOf(a) && b < a) ? b : a,
    );
    const keep = new Set([dispBin, ...(neededBins.get(id) ?? [])]);

    for (const bin of keep) {
      const rows = byBin.get(bin);
      if (!rows) {
        skip("current ref: missing referenced bin", `${id}_${bin}`);
        continue;
      }
      const o = await mdapiGet<CurrOffsetsResp>(
        `stations/${id}_${bin}/currentpredictionoffsets.json`,
      );
      if (o?.meanFloodDir == null || o.meanEbbDir == null) {
        skip("current ref: no flood/ebb dirs", `${id}_${bin}`);
        continue;
      }
      const { amp, phase } = denseArrays(
        rows.map((c) => ({
          name: c.constituentName,
          amp: c.majorAmplitude,
          phase: c.majorPhaseGMT,
        })),
        2,
      );
      const station: CurrentRefStation = {
        id,
        name: s.name,
        lat: round(s.lat, 5),
        lng: round(s.lng, 5),
        bin,
        binDepth: rows[0].binDepth != null ? round(rows[0].binDepth, 1) : null,
        floodDir: o.meanFloodDir,
        ebbDir: o.meanEbbDir,
        amp,
        phase,
      };
      if (bin === dispBin) station.disp = 1;
      currentRef.push(station);
    }
  });

  // Drop subs whose referenced (id, bin) didn't survive
  const refBins = new Set(currentRef.map((r) => `${r.id}_${r.bin}`));
  const keptSubs = currentSub.filter((sub) => {
    if (refBins.has(`${sub.refId}_${sub.refBin}`)) return true;
    skip("current sub: reference bin dropped", sub.id);
    return false;
  });

  return { currentRef, currentSub: keptSubs };
}

// ── Validation ────────────────────────────────────────────────────────

/** Construct a predictor for every harmonic station; drop any the engine rejects. */
function validateStations(bundle: TidesBundle): void {
  const constituentsOf = (amp: number[], phase: number[]) =>
    amp
      .map((a, i) => ({
        name: bundle.constituents[i],
        amplitude: a,
        phase: phase[i],
      }))
      .filter((c) => c.amplitude > 0);

  bundle.tideRef = bundle.tideRef.filter((s) => {
    try {
      createTidePredictor(constituentsOf(s.amp, s.phase), { offset: s.datum });
      return true;
    } catch (err) {
      skip(`tide ref: engine rejected (${(err as Error).message})`, s.id);
      return false;
    }
  });
  bundle.currentRef = bundle.currentRef.filter((s) => {
    try {
      createTidePredictor(constituentsOf(s.amp, s.phase), { offset: false });
      return true;
    } catch (err) {
      skip(`current ref: engine rejected (${(err as Error).message})`, s.id);
      return false;
    }
  });

  // Sanity-check a sample: a day of Boston tides should have 2 highs ≥ 2 m
  const boston = bundle.tideRef.find((s) => s.id === "8443970");
  if (boston) {
    const predictor = createTidePredictor(
      constituentsOf(boston.amp, boston.phase),
      { offset: boston.datum },
    );
    const extremes = predictor.getExtremesPrediction({
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-01-02T01:00:00Z"),
    });
    const highs = extremes.filter((e) => e.high);
    if (highs.length < 2 || highs.some((h) => h.level < 2 || h.level > 4)) {
      throw new Error(
        `Boston sanity check failed: ${JSON.stringify(extremes)}`,
      );
    }
    console.log("Boston sanity check passed");
  }
}

// ── Main ──────────────────────────────────────────────────────────────

const { tideRef, tideSub } = await crawlTides();
const { currentRef, currentSub } = await crawlCurrents();

const bundle: TidesBundle = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  constituents: constituentNames,
  tideRef,
  tideSub,
  currentRef,
  currentSub,
};

validateStations(bundle);

const json = JSON.stringify(bundle);
await writeFile(OUT_FILE, json);

const gzipped = gzipSync(json);
console.log(`\nWrote ${OUT_FILE}`);
console.log(
  `  tideRef=${bundle.tideRef.length} tideSub=${bundle.tideSub.length} ` +
    `currentRef=${bundle.currentRef.length} (disp=${bundle.currentRef.filter((s) => s.disp).length}) ` +
    `currentSub=${bundle.currentSub.length} constituents=${constituentNames.length}`,
);
console.log(
  `  size: ${(json.length / 1e6).toFixed(2)} MB raw, ${(gzipped.length / 1e6).toFixed(2)} MB gzipped`,
);
console.log(`  API: ${fetchCount} fetched, ${cacheHits} from cache`);
for (const [reason, ids] of Object.entries(skipped)) {
  console.log(
    `  skipped ${ids.length}: ${reason} (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""})`,
  );
}
