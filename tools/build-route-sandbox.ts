/**
 * Bundle src/navigation/route-sandbox.ts into one script for the Android
 * background service's JavaScriptSandbox, exposing its exports as
 * `globalThis.pelorusRoute`.
 *
 * Usage: bun tools/build-route-sandbox.ts
 * Output: android/app/src/main/assets/route-sandbox.js
 */

const OUT = "android/app/src/main/assets/route-sandbox.js";

const result = await Bun.build({
  entrypoints: ["src/navigation/route-sandbox.ts"],
  format: "esm",
  target: "browser",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const esm = await result.outputs[0].text();
// The sandbox evaluates plain scripts, not modules: turn the bundle's one
// export statement into a global.
const exportAt = esm.lastIndexOf("export{");
if (exportAt < 0) throw new Error("bundle has no export statement");
const exported = esm
  .slice(exportAt + "export{".length, esm.indexOf("}", exportAt))
  .split(",")
  .map((spec) => {
    const [local, name = local] = spec.split(" as ");
    return `${name}:${local}`;
  })
  .join(",");
const script = `(()=>{${esm.slice(0, exportAt)}globalThis.pelorusRoute={${exported}};})();\n`;
await Bun.write(OUT, script);
console.log(`${OUT}: ${script.length} bytes`);
