/**
 * S-57 click-output coverage.
 *
 * Drives the pure `formatFeatureInfo()` over EVERY synthetic variant in the
 * test-chart catalog (tools/s57-test-chart/catalog.ts) and verifies what the
 * app shows when each feature is clicked. Also emits a human-readable report
 * (out/click-report.md) of every clickable class's formatted output + gaps.
 *
 * "Clickable" = the class appears in FeatureQueryHandler's INTERACTIVE_SUFFIXES.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildVariants } from "../../tools/s57-test-chart/catalog";
import { getSettings, updateSettings } from "../settings";
import { type FeatureInfo, formatFeatureInfo } from "./feature-info";

// Stub localStorage for settings in the node test environment
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, val: string) {
        this.store[key] = val;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
    },
  });
}

// Base S-57 classes that are clickable (derived from
// FeatureQueryHandler.INTERACTIVE_SUFFIXES — the first segment of each suffix).
const CLICKABLE = new Set([
  "BOYLAT",
  "BOYCAR",
  "BOYSAW",
  "BOYSPP",
  "BOYISD",
  "BCNLAT",
  "BCNCAR",
  "BCNISD",
  "BCNSAW",
  "BCNSPP",
  "LNDMRK",
  "LIGHTS",
  "FOGSIG",
  "WRECKS",
  "OBSTRN",
  "UWTROC",
  "RESARE",
  "ACHARE",
  "CTNARE",
  "FAIRWY",
  "TSSLPT",
  "PILPNT",
  "MORFAC",
  "CBLSUB",
  "CBLOHD",
  "CBLARE",
  "PIPARE",
  "PIPSOL",
  "SILTNK",
  "HRBFAC",
  "OFSPLF",
  "BERTHS",
  "BUISGL",
  "SEAARE",
  "LNDARE",
  "SOUNDG",
  "SLCONS",
  "SMCFAC",
  "BUAARE",
  "LNDRGN",
  "LNDELV",
  "BRIDGE",
  "PRCARE",
  "PILBOP",
  "WATTUR",
  "GATCON",
  "DAMCON",
  "TUNNEL",
  "FSHFAC",
  "DYKCON",
  "SLOTOP",
  "PYLONS",
  "CRANES",
  "FORSTC",
  "CGUSTA",
  "MARCUL",
  "HULKES",
  "DRYDOC",
  "RUNWAY",
  "AIRARE",
  "WEDKLP",
  "MIPARE",
  "OSPARE",
  "TESARE",
  "EXEZNE",
  "ISTZNE",
  "TSSRON",
  "FERYRT",
  "SWPARE",
  "OVFALL",
  "SNDWAV",
  "SPRING",
  "CURENT",
  "LITFLT",
  "LITVES",
  "RDOCAL",
  "RSCSTA",
  "SISTAT",
  "RETRFL",
  "DAYMAR",
  "RTPBCN",
  "RDOSTA",
  "SPLARE",
  "VEGATN",
  "FLODOC",
  "PIPOHD",
  "SLOGRD",
]);

// A detail label that is a raw S-57 mnemonic (e.g. CATGAT, VERCLR, DRVAL1) means
// the value was shown un-decoded — a UX gap (fallback or unhandled attribute).
const isRawCode = (label: string) => /^[A-Z][A-Z0-9]{2,5}$/.test(label);
const titleBase = (type: string) => type.split(" [")[0];

interface Row {
  id: string;
  cls: string;
  geometry: string;
  labeled: boolean;
  clickable: boolean;
  info: FeatureInfo;
  rawLeakLabels: string[];
  noDisplayName: boolean;
  noDetails: boolean;
}

const variants = buildVariants();
const rows: Row[] = [];

describe("S-57 click-output coverage", () => {
  const savedUnit = getSettings().depthUnit;
  beforeAll(() => {
    updateSettings({ depthUnit: "meters" });
    for (const v of variants) {
      const info = formatFeatureInfo(
        v.cls,
        v.properties,
        undefined,
        v.geometry,
      );
      rows.push({
        id: v.id,
        cls: v.cls,
        geometry: v.geometry,
        labeled: v.labeled,
        clickable: CLICKABLE.has(v.cls),
        info,
        rawLeakLabels: info.details
          .filter((d) => isRawCode(d.label))
          .map((d) => d.label),
        noDisplayName: titleBase(info.type) === v.cls,
        noDetails: info.details.length === 0,
      });
    }
  });

  it("never throws and always yields a non-empty type + details array for all variants", () => {
    for (const r of rows) {
      expect(r.info.type, r.id).toBeTruthy();
      expect(Array.isArray(r.info.details), r.id).toBe(true);
    }
    expect(rows.length).toBe(variants.length);
  });

  it("never shows the user a raw, un-decoded S-57 attribute code", () => {
    const leaks = rows
      .filter((r) => r.clickable && r.rawLeakLabels.length > 0)
      .map((r) => `${r.id}: ${r.rawLeakLabels.join(",")}`);
    expect(leaks).toEqual([]);
  });

  it("gives every clickable class a human display name (never the raw code)", () => {
    const noNames = [
      ...new Set(
        rows.filter((r) => r.clickable && r.noDisplayName).map((r) => r.cls),
      ),
    ];
    expect(noNames).toEqual([]);
  });

  // Classes that legitimately show only a title (sparse areas/boundaries with no
  // extra attributes). A *new* class showing nothing should fail this guard.
  it("only the documented sparse classes show a title with no details", () => {
    const ALLOWED_TITLE_ONLY = new Set([
      "LNDARE",
      "SLOGRD",
      "RETRFL",
      "OVFALL",
      "SNDWAV",
      "LNDMRK",
      "HRBFAC",
      "TSSRON",
      "ISTZNE",
      "CTNARE",
      "TESARE",
      "EXEZNE",
    ]);
    const firstByClass = new Map<string, Row>();
    for (const r of rows)
      if (r.clickable && !firstByClass.has(r.cls)) firstByClass.set(r.cls, r);
    const titleOnly = [...firstByClass.values()]
      .filter((r) => r.noDetails)
      .map((r) => r.cls);
    const unexpected = titleOnly.filter((c) => !ALLOWED_TITLE_ONLY.has(c));
    expect(unexpected).toEqual([]);
  });

  // Targeted "what we show" assertions for high-value clickable classes.
  it("lateral buoy: shape, category, colour", () => {
    const i = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      BOYSHP: 2,
      COLOUR: "3",
      LABEL: "1",
    });
    expect(i.type).toBe("Lateral Buoy");
    expect(i.details).toContainEqual({ label: "Category", value: "Port" });
    expect(i.details).toContainEqual({ label: "Appearance", value: "Red Can" });
  });
  it("navigation light: characteristic, height, range, colour", () => {
    const i = formatFeatureInfo("LIGHTS", {
      LITCHR: 2,
      COLOUR: "1",
      SIGGRP: "(1)",
      SIGPER: 4,
      VALNMR: 18,
      HEIGHT: 25,
      LABEL: "Fl W 4s 25m 18M",
    });
    expect(i.type).toBe("Navigation Light");
    expect(i.details).toContainEqual({ label: "Height", value: "25.0m" });
    expect(i.details).toContainEqual({
      label: "Nominal Range",
      value: "18 NM",
    });
    expect(i.details).toContainEqual({ label: "Color", value: "White" });
  });
  it("dangerous wreck: annotates depth in the title + category + water level", () => {
    const i = formatFeatureInfo("WRECKS", {
      CATWRK: 2,
      WATLEV: 3,
      VALSOU: 4.5,
    });
    expect(i.type).toBe("Wreck [Depth: 4.5m]");
    expect(i.details).toContainEqual({ label: "Category", value: "Dangerous" });
    expect(i.details).toContainEqual({
      label: "Water Level",
      value: "Always underwater",
    });
  });
  it("obstruction: decodes CATOBS + annotates depth", () => {
    const i = formatFeatureInfo("OBSTRN", {
      CATOBS: 6,
      WATLEV: 3,
      VALSOU: 2.1,
    });
    expect(i.type).toBe("Obstruction [Depth: 2.1m]");
    expect(i.details).toContainEqual({ label: "Category", value: "Foul area" });
  });
  it("sounding: shows depth in the active unit", () => {
    const i = formatFeatureInfo("SOUNDG", { DEPTH: 2.4 });
    expect(i.type).toBe("Sounding");
    expect(i.details).toContainEqual({ label: "Depth", value: "2.4m" });
  });
  it("bridge: category + vertical clearance", () => {
    const i = formatFeatureInfo("BRIDGE", { CATBRG: 5, VERCLR: 12 });
    expect(i.type).toBe("Bridge");
    expect(i.details).toContainEqual({ label: "Type", value: "Bascule" });
    expect(i.details).toContainEqual({
      label: "Vertical Clearance",
      value: "12.0m",
    });
  });
  it("TSS lane: category + orientation", () => {
    const i = formatFeatureInfo("TSSLPT", { ORIENT: 45, CATTSS: 1 });
    expect(i.type).toBe("Traffic Separation Lane");
    expect(i.details).toContainEqual({
      label: "Category",
      value: "IMO-adopted",
    });
    expect(
      i.details.some(
        (d) => d.label === "Orientation" && d.value.includes("45"),
      ),
    ).toBe(true);
  });
  it("small craft facility: expands a multi-value CATSCF list", () => {
    const i = formatFeatureInfo("SMCFAC", {
      CATSCF: "14,7,26",
      OBJNAM: "Marina",
    });
    expect(i.type).toBe("Small Craft Facility");
    expect(i.details).toContainEqual({
      label: "Facility",
      value: "Marina, Fuel Station, Pumpout",
    });
  });

  // Report is written in afterAll.
  afterAll(() => {
    const clickableRows = rows.filter((r) => r.clickable);
    const rawLeaks = clickableRows.filter((r) => r.rawLeakLabels.length > 0);
    const noNames = [
      ...new Set(
        clickableRows.filter((r) => r.noDisplayName).map((r) => r.cls),
      ),
    ];
    const noDetails = clickableRows.filter((r) => r.noDetails && !r.labeled);

    const lines: string[] = [];
    lines.push("# S-57 click-output coverage report\n");
    lines.push(
      `Generated from ${variants.length} synthetic variants across ${new Set(variants.map((v) => v.cls)).size} S-57 classes.\n`,
    );
    lines.push(
      `- Clickable classes exercised: ${new Set(clickableRows.map((r) => r.cls)).size}`,
    );
    lines.push(
      `- Variants with raw (un-decoded) attribute codes shown: ${rawLeaks.length}`,
    );
    lines.push(
      `- Clickable classes with no human display name: ${noNames.length}`,
    );
    lines.push(
      `- Clickable variants showing no details at all: ${noDetails.length}\n`,
    );

    if (rawLeaks.length) {
      lines.push("## ⚠ Raw attribute codes shown to the user (decode gaps)\n");
      for (const r of rawLeaks)
        lines.push(
          `- \`${r.cls}\` (${r.geometry}) → ${r.rawLeakLabels.join(", ")}`,
        );
      lines.push("");
    }
    if (noNames.length) {
      lines.push(
        "## ⚠ Clickable classes with no display name (shows the raw code)\n",
      );
      lines.push(`${noNames.map((c) => `\`${c}\``).join(", ")}\n`);
    }

    lines.push("## What each clickable class shows\n");
    const seen = new Set<string>();
    for (const r of clickableRows) {
      if (seen.has(r.cls)) continue;
      seen.add(r.cls);
      lines.push(
        `### ${r.cls} — "${r.info.type}"${r.info.name ? ` (name: ${r.info.name})` : ""}`,
      );
      if (r.info.details.length === 0) lines.push("- _(no details)_");
      for (const d of r.info.details) lines.push(`- ${d.label}: ${d.value}`);
      lines.push("");
    }

    const HERE = dirname(fileURLToPath(import.meta.url));
    const outDir = join(HERE, "..", "..", "tools", "s57-test-chart", "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "click-report.md"), lines.join("\n"));

    updateSettings({ depthUnit: savedUnit });
  });
});
