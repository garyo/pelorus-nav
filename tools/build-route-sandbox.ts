/**
 * Bundle src/navigation/route-sandbox.ts into one plain script for the
 * Android background service's JavaScriptSandbox, exposing its exports as
 * the global `pelorusRoute`.
 *
 * Usage: bun tools/build-route-sandbox.ts
 * Output: android/app/src/main/assets/route-sandbox.js (committed; a unit
 * test fails when it is stale)
 */

import { writeFileSync } from "node:fs";
import { build } from "esbuild";

export const ROUTE_SANDBOX_ASSET =
  "android/app/src/main/assets/route-sandbox.js";

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
  writeFileSync(ROUTE_SANDBOX_ASSET, script);
  console.log(`${ROUTE_SANDBOX_ASSET}: ${script.length} bytes`);
}
