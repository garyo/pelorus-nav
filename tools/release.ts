#!/usr/bin/env bun
/**
 * Cut a release: date the changelog's Unreleased entries as <version>, bump
 * package.json, run the full check, then commit and tag. With --push, also
 * push main and the tag, which ships everywhere: the web app deploys from
 * main, release.yml publishes Android to Google Play production, and
 * release-ios.yml submits iOS for App Store review. Each store releases once
 * its review passes.
 *
 *   bun run release <x.y.z> [--push]
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseChangelogSection } from "../src/ui/changelog-parse";
import { isNewerVersion } from "../src/utils/version";
import { STORE_LIMITS, type Store, storeNotes } from "./release-notes";

const UNRELEASED = "## [Unreleased]\n";

function run(cmd: string, ...args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout.trim();
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const version = process.argv[2] ?? "";
const push = process.argv.includes("--push");
const pkg = readFileSync("package.json", "utf8");
const current: string = JSON.parse(pkg).version;
if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewerVersion(version, current)) {
  fail(`usage: bun run release <x.y.z> [--push] (newer than ${current})`);
}

if (run("git", "branch", "--show-current") !== "main") fail("Not on main.");
if (run("git", "status", "--porcelain")) fail("The working tree isn't clean.");
run("git", "fetch", "--quiet", "origin");
if (run("git", "rev-list", "--count", "HEAD..origin/main") !== "0") {
  fail("main is behind origin/main; pull first.");
}
if (run("git", "tag", "--list", `v${version}`)) fail(`v${version} exists.`);

const changelog = readFileSync("CHANGELOG.md", "utf8");
if (!changelog.includes(UNRELEASED)) fail("CHANGELOG.md has no Unreleased.");
const d = new Date();
const date = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
  .map((n) => String(n).padStart(2, "0"))
  .join("-");
const dated = changelog.replace(
  UNRELEASED,
  `${UNRELEASED}\n## [${version}] - ${date}\n`,
);
const section = parseChangelogSection(dated, version);
if (!section) fail("The Unreleased section lists nothing to release.");

writeFileSync("CHANGELOG.md", dated);
writeFileSync(
  "package.json",
  pkg.replace(`"version": "${current}"`, `"version": "${version}"`),
);

for (const store of Object.keys(STORE_LIMITS) as Store[]) {
  console.log(
    `\n── ${store} notes ──\n${storeNotes(section, STORE_LIMITS[store])}`,
  );
}
console.log();

if (spawnSync("bun", ["run", "check"], { stdio: "inherit" }).status !== 0) {
  run("git", "checkout", "--", "CHANGELOG.md", "package.json");
  fail("\nbun run check failed; the release files are restored.");
}

run("git", "add", "CHANGELOG.md", "package.json");
run("git", "commit", "--quiet", "-m", `chore(release): ${version}`);
run("git", "tag", "-a", `v${version}`, "-m", `Pelorus Nav v${version}`);
console.log(`Committed and tagged v${version}.`);

if (push) {
  run("git", "push", "--quiet", "origin", "main");
  run("git", "push", "--quiet", "origin", `v${version}`);
  console.log("Pushed. Watch the runs with: gh run list --limit 3");
} else {
  console.log(
    `To ship it: git push origin main && git push origin v${version}`,
  );
}
