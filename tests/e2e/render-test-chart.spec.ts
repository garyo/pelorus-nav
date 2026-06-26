import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";

/**
 * Headless render-coverage harness for the synthetic S-57 test chart.
 *
 * Drives the REAL production nautical styles over `public/test-chart.pmtiles`
 * (built by `bun tools/s57-test-chart/generate.ts`) and, for every variant in
 * the manifest, records whether ≥1 feature actually rendered at its point, the
 * `icon-image`(s) that resolved there, and any `styleimagemissing` events. The
 * app side is wired by the `?testChart=1` hook in `src/main.ts`.
 *
 * Outputs (all under tools/s57-test-chart/out/, gitignored):
 *   renders/<scheme>/<variantId>.png   per-variant canvas capture
 *   render-report.md                   the coverage report
 *   renders/contact-<scheme>.png       montage (if ImageMagick is present)
 *
 * Primary value is the programmatic report (missing icons + blank POINT
 * classes); screenshots are secondary. Full screenshots are captured for
 * pelorus-standard; iho-s52 collects programmatic data only (sampled shots).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "tools", "s57-test-chart", "out");
const RENDERS = join(OUT, "renders");
const TEST_SOURCE_ID = "s57-test";

type Geom = "Point" | "LineString" | "Polygon";

interface Variant {
  id: string;
  cls: string;
  geometry: Geom;
  labeled: boolean;
  properties: Record<string, unknown>;
  lng: number;
  lat: number;
}

interface Manifest {
  count: number;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  variants: Variant[];
}

/** Result captured for one variant under one symbology scheme. */
interface VariantResult {
  id: string;
  cls: string;
  geometry: Geom;
  labeled: boolean;
  rendered: boolean;
  hasSymbol: boolean;
  hasIcon: boolean;
  layerTypes: string[];
  layerIds: string[];
  iconImages: string[];
}

const manifest: Manifest = JSON.parse(
  readFileSync(join(OUT, "manifest.json"), "utf8"),
);

const SCHEMES = ["pelorus-standard", "iho-s52"] as const;
type Scheme = (typeof SCHEMES)[number];

// The probe runs inside the page; types here mirror the shape we use.
interface ProbeMap {
  isStyleLoaded(): boolean;
  areTilesLoaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  project(p: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
  queryRenderedFeatures(geom: [[number, number], [number, number]]): Array<{
    source?: string;
    sourceLayer?: string;
    layer?: { id: string; type: string; layout?: Record<string, unknown> };
  }>;
}

test("S-57 test-chart render coverage", async ({ page }) => {
  test.setTimeout(40 * 60 * 1000);

  const results: Record<Scheme, VariantResult[]> = {
    "pelorus-standard": [],
    "iho-s52": [],
  };
  const missingBySchemeSet: Record<Scheme, Set<string>> = {
    "pelorus-standard": new Set(),
    "iho-s52": new Set(),
  };

  const center: [number, number] = [
    (manifest.bbox.minLng + manifest.bbox.maxLng) / 2,
    (manifest.bbox.minLat + manifest.bbox.maxLat) / 2,
  ];

  for (const scheme of SCHEMES) {
    const captureShots = scheme === "pelorus-standard";

    // Seed settings before boot: day theme, no GPS, no network underlays, the
    // chosen symbology (so the sprite sheet the style loads matches the layers
    // the test hook builds).
    await page.addInitScript(
      ([sch, ctr]) => {
        const raw = localStorage.getItem("pelorus-nav-settings");
        const s = raw ? JSON.parse(raw) : {};
        s.symbologyScheme = sch;
        s.displayTheme = "day";
        s.gpsSource = "none";
        s.detailLevel = 2;
        s.streetUnderlay = "off";
        s.chartBlend = "vector";
        s.trackRecordingEnabled = false;
        localStorage.setItem("pelorus-nav-settings", JSON.stringify(s));
        localStorage.setItem(
          "pelorus-nav-map-position",
          JSON.stringify({ center: ctr, zoom: 12 }),
        );
      },
      [scheme, center] as [string, [number, number]],
    );

    await page.goto(`/?testChart=1&scheme=${scheme}`);
    await page.locator(".maplibregl-map").waitFor({ timeout: 20000 });

    // Wait for the test-chart hook to add its layers + source.
    await page.waitForFunction(
      () =>
        (window as unknown as { __testChartReady?: boolean })
          .__testChartReady === true,
      { timeout: 30000 },
    );

    // Wait for the test source to have any tiles loaded at the start view.
    await page
      .waitForFunction(
        () => {
          const m = (window as unknown as { __map?: ProbeMap }).__map;
          return !!m && m.isStyleLoaded() && m.areTilesLoaded();
        },
        { timeout: 15000 },
      )
      .catch(() => {});

    for (const v of manifest.variants) {
      // Move to the variant and let tiles + collision settle.
      await page.evaluate(
        ([lng, lat]) => {
          const m = (window as unknown as { __map: ProbeMap }).__map;
          m.jumpTo({ center: [lng, lat], zoom: 17 });
        },
        [v.lng, v.lat] as [number, number],
      );
      await page
        .waitForFunction(
          () => {
            const m = (window as unknown as { __map?: ProbeMap }).__map;
            return !!m && m.areTilesLoaded();
          },
          { timeout: 8000 },
        )
        .catch(() => {});
      // Symbol placement (icons/labels) happens asynchronously a few frames
      // AFTER tiles load — fills render immediately, symbols don't. Poll the
      // test-source query at the point until something renders, bounded so a
      // genuinely-blank variant only costs the timeout. This is what separates
      // "no symbol yet" (timing) from "renders nothing" (real).
      await page
        .waitForFunction(
          ([lng, lat, srcId]) => {
            const m = (window as unknown as { __map?: ProbeMap }).__map;
            if (!m) return false;
            const p = m.project([lng as number, lat as number]);
            const box: [[number, number], [number, number]] = [
              [p.x - 4, p.y - 4],
              [p.x + 4, p.y + 4],
            ];
            return (
              m.queryRenderedFeatures(box).filter((f) => f.source === srcId)
                .length > 0
            );
          },
          [v.lng, v.lat, TEST_SOURCE_ID] as [number, number, string],
          { timeout: 1500, polling: 100 },
        )
        .catch(() => {});

      const probe = await page.evaluate(
        ([lng, lat, srcId]) => {
          const m = (window as unknown as { __map: ProbeMap }).__map;
          const p = m.project([lng as number, lat as number]);
          const box: [[number, number], [number, number]] = [
            [p.x - 4, p.y - 4],
            [p.x + 4, p.y + 4],
          ];
          const feats = m
            .queryRenderedFeatures(box)
            .filter((f) => f.source === srcId);
          const layerTypes = new Set<string>();
          const layerIds = new Set<string>();
          const iconImages = new Set<string>();
          let hasSymbol = false;
          let hasIcon = false;
          for (const f of feats) {
            const layer = f.layer;
            if (!layer) continue;
            layerTypes.add(layer.type);
            layerIds.add(layer.id);
            if (layer.type === "symbol") {
              hasSymbol = true;
              const icon = layer.layout?.["icon-image"];
              if (icon != null) {
                hasIcon = true;
                iconImages.add(typeof icon === "string" ? icon : "⟨expr⟩");
              }
            }
          }
          return {
            rendered: feats.length > 0,
            hasSymbol,
            hasIcon,
            layerTypes: [...layerTypes],
            layerIds: [...layerIds],
            iconImages: [...iconImages],
          };
        },
        [v.lng, v.lat, TEST_SOURCE_ID] as [number, number, string],
      );

      results[scheme].push({
        id: v.id,
        cls: v.cls,
        geometry: v.geometry,
        labeled: v.labeled,
        ...probe,
      });

      if (captureShots) {
        const dataUrl = await page.evaluate(() => {
          const m = (window as unknown as { __map: ProbeMap }).__map;
          return m.getCanvas().toDataURL("image/png");
        });
        const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        const dir = join(RENDERS, scheme);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${v.id}.png`), Buffer.from(b64, "base64"));
      }
    }

    const missing = await page.evaluate(
      () =>
        (window as unknown as { __missingIcons?: string[] }).__missingIcons ??
        [],
    );
    for (const id of missing) missingBySchemeSet[scheme].add(id);
  }

  // ── Build the report ──────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push("# S-57 Test-Chart Render Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Variants in manifest: ${manifest.count}`);
  lines.push("");

  for (const scheme of SCHEMES) {
    const rs = results[scheme];
    const missing = [...missingBySchemeSet[scheme]].sort();
    const renderedCount = rs.filter((r) => r.rendered).length;
    const blank = rs.filter((r) => !r.rendered);
    // Point features that rendered nothing or no symbol at all.
    const blankPoints = rs.filter(
      (r) => r.geometry === "Point" && (!r.rendered || !r.hasSymbol),
    );
    // Point features that rendered a symbol but with no icon-image layer.
    const noIconPoints = rs.filter(
      (r) => r.geometry === "Point" && r.rendered && r.hasSymbol && !r.hasIcon,
    );

    lines.push(`## Scheme: ${scheme}`);
    lines.push("");
    lines.push(`- Total variants: ${rs.length}`);
    lines.push(`- Rendered ≥1 feature at point: ${renderedCount}`);
    lines.push(`- Rendered NOTHING: ${blank.length}`);
    lines.push(
      `- POINT variants blank (no icon/symbol): ${blankPoints.length}`,
    );
    lines.push(
      `- POINT variants rendered but NO icon-image layer: ${noIconPoints.length}`,
    );
    lines.push(
      `- Distinct missing icons (styleimagemissing): ${missing.length}`,
    );
    lines.push("");

    lines.push("### Blank variants (rendered nothing at their point)");
    if (blank.length === 0) {
      lines.push("_none_");
    } else {
      for (const r of blank) {
        lines.push(`- \`${r.id}\` — ${r.cls} (${r.geometry})`);
      }
    }
    lines.push("");

    lines.push(
      "### POINT variants with no icon (blank or symbol-without-icon)",
    );
    const pointConcern = [...blankPoints, ...noIconPoints].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    if (pointConcern.length === 0) {
      lines.push("_none — every POINT variant rendered a symbol with an icon_");
    } else {
      for (const r of pointConcern) {
        const why = !r.rendered
          ? "NOTHING rendered"
          : !r.hasSymbol
            ? "no symbol layer"
            : "symbol but no icon-image";
        lines.push(`- \`${r.id}\` — ${r.cls}: ${why}`);
      }
    }
    lines.push("");

    lines.push("### Missing icons (styleimagemissing)");
    if (missing.length === 0) {
      lines.push("_none_");
    } else {
      for (const id of missing) lines.push(`- \`${id}\``);
    }
    lines.push("");

    // Per-class summary of resolved icon-image values.
    lines.push("### Per-class icon-image summary");
    const byClass = new Map<
      string,
      {
        geoms: Set<string>;
        icons: Set<string>;
        rendered: number;
        total: number;
      }
    >();
    for (const r of rs) {
      let e = byClass.get(r.cls);
      if (!e) {
        e = { geoms: new Set(), icons: new Set(), rendered: 0, total: 0 };
        byClass.set(r.cls, e);
      }
      e.geoms.add(r.geometry);
      e.total++;
      if (r.rendered) e.rendered++;
      for (const i of r.iconImages) e.icons.add(i);
    }
    lines.push("");
    lines.push("| Class | Geoms | Rendered/Total | icon-image(s) |");
    lines.push("|---|---|---|---|");
    for (const cls of [...byClass.keys()].sort()) {
      const e = byClass.get(cls);
      if (!e) continue;
      const icons = e.icons.size ? [...e.icons].sort().join(", ") : "—";
      lines.push(
        `| ${cls} | ${[...e.geoms].sort().join("/")} | ${e.rendered}/${e.total} | ${icons} |`,
      );
    }
    lines.push("");
  }

  writeFileSync(join(OUT, "render-report.md"), `${lines.join("\n")}\n`);

  // ── Contact sheet (best-effort) ──────────────────────────────────────
  for (const scheme of SCHEMES) {
    const dir = join(RENDERS, scheme);
    if (!existsSync(dir)) continue;
    try {
      execFileSync(
        "montage",
        [
          join(dir, "*.png"),
          "-tile",
          "8x",
          "-geometry",
          "200x150+2+2",
          "-background",
          "gray",
          join(RENDERS, `contact-${scheme}.png`),
        ],
        { shell: true, stdio: "ignore" },
      );
    } catch {
      // montage missing or failed — programmatic report is the primary output.
    }
  }
});
