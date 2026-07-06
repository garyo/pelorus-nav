// Vite `?raw` imports (e.g. `import text from "../../CHANGELOG.md?raw"`) —
// the file's contents are inlined as a string at build time.
declare module "*?raw" {
  const content: string;
  export default content;
}
