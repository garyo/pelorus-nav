/**
 * Bundle src/navigation/route-sandbox.ts into one plain script for the native
 * route followers — Android's JavaScriptSandbox (RouteSandbox.kt) and iOS's
 * JavaScriptCore (RouteSandbox.swift) — exposing its exports as the global
 * `pelorusRoute`.
 *
 * Usage: bun tools/build-route-sandbox.ts
 * Output: ROUTE_SANDBOX_ASSETS (committed; a unit test fails when either is
 * stale)
 */

import { writeFileSync } from "node:fs";
import { build } from "esbuild";

export const ROUTE_SANDBOX_ASSETS = [
  "android/app/src/main/assets/route-sandbox.js",
  "ios/App/App/NativeAssets/route-sandbox.js",
];

export async function buildRouteSandbox(): Promise<string> {
  const result = await build({
    entryPoints: ["src/navigation/route-sandbox.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "pelorusRoute",
    target: "es2020",
    minify: true,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

if (import.meta.main) {
  const script = await buildRouteSandbox();
  for (const path of ROUTE_SANDBOX_ASSETS) {
    writeFileSync(path, script);
    console.log(`${path}: ${script.length} bytes`);
  }
}
