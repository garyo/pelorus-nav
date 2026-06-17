#!/usr/bin/env bun
// Stamp package.json's version into the iOS project's MARKETING_VERSION so the
// marketing version stays in sync across web / Android / iOS from one source of
// truth. Idempotent: a no-op (and silent about edits) when already in sync.
//
// The build number (CURRENT_PROJECT_VERSION) is deliberately NOT touched here —
// it derives from the git commit count and is injected at build time by the CI
// workflow and tools/ios-beta.sh, so it never churns the committed project file.
//
// Runs automatically before every iOS build via the cap:*:ios package scripts.

import { readFileSync, writeFileSync } from "node:fs";

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

const version = JSON.parse(readFileSync("package.json", "utf8"))
  .version as string;
const src = readFileSync(PBXPROJ, "utf8");
const next = src.replace(
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${version};`,
);

if (next === src) {
  console.log(`iOS MARKETING_VERSION already ${version}`);
} else {
  writeFileSync(PBXPROJ, next);
  console.log(`Set iOS MARKETING_VERSION = ${version}`);
}
