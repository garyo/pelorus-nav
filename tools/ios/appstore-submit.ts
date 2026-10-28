#!/usr/bin/env bun
/**
 * Submit an uploaded build for App Store review: create the App Store version
 * for package.json's version (or reuse one already created), set its "What's
 * New" from CHANGELOG.md, attach the build, and submit it, set to release as
 * soon as Apple approves it.
 *
 *   bun tools/ios/appstore-submit.ts [--dry-run]
 *
 * Env: as asc.ts, plus BUILD_NUMBER. --dry-run only reads, and prints what it
 * would do.
 */

import { readFileSync } from "node:fs";
import { parseChangelogSection } from "../../src/ui/changelog-parse";
import { STORE_LIMITS, storeNotes } from "../release-notes";
import {
  asc,
  env,
  expectStatus,
  findApp,
  type Resource,
  ref,
  waitForBuild,
} from "./asc";

/** Version states that can still be edited and submitted. */
const EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

const dryRun = process.argv.includes("--dry-run");

function plan(action: string): boolean {
  console.log(`${dryRun ? "Would" : "→"} ${action}`);
  return !dryRun;
}

async function findOrCreateVersion(
  appId: string,
  version: string,
): Promise<Resource | null> {
  const r = await asc(
    "GET",
    `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${version}`,
  );
  expectStatus(r, [200], "Version lookup");
  if (r.data[0]) return r.data[0];
  if (!plan(`create App Store version ${version}`)) return null;
  const created = await asc("POST", "/v1/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: {
        platform: "IOS",
        versionString: version,
        releaseType: "AFTER_APPROVAL",
      },
      relationships: { app: ref("apps", appId) },
    },
  });
  expectStatus(created, [201], `Create version ${version}`);
  return created.data[0];
}

async function setWhatsNew(versionId: string, notes: string): Promise<void> {
  const r = await asc(
    "GET",
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
  );
  expectStatus(r, [200], "Localization lookup");
  for (const loc of r.data) {
    if (!plan(`set What's New (${loc.attributes?.locale})`)) continue;
    const u = await asc("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, {
      data: {
        type: "appStoreVersionLocalizations",
        id: loc.id,
        attributes: { whatsNew: notes },
      },
    });
    expectStatus(u, [200], `What's New (${loc.attributes?.locale})`);
  }
}

async function submit(appId: string, versionId: string): Promise<void> {
  // An unsubmitted draft (say, started by hand in App Store Connect) is
  // reused; Apple allows one per platform.
  const open = await asc(
    "GET",
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`,
  );
  expectStatus(open, [200], "Review submission lookup");
  if (!plan("submit for App Store review")) return;

  let submissionId = open.data[0]?.id;
  if (!submissionId) {
    const created = await asc("POST", "/v1/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: ref("apps", appId) },
      },
    });
    expectStatus(created, [201], "Create review submission");
    submissionId = created.data[0].id;
  }
  const item = await asc("POST", "/v1/reviewSubmissionItems", {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: ref("reviewSubmissions", submissionId),
        appStoreVersion: ref("appStoreVersions", versionId),
      },
    },
  });
  expectStatus(item, [201, 409], "Add version to review submission");
  const sent = await asc("PATCH", `/v1/reviewSubmissions/${submissionId}`, {
    data: {
      type: "reviewSubmissions",
      id: submissionId,
      attributes: { submitted: true },
    },
  });
  expectStatus(sent, [200], "Submit for review");
}

async function main(): Promise<void> {
  const version: string = JSON.parse(
    readFileSync("package.json", "utf8"),
  ).version;
  const buildNumber = env("BUILD_NUMBER");
  const section = parseChangelogSection(
    readFileSync("CHANGELOG.md", "utf8"),
    version,
  );
  if (!section) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  const notes = storeNotes(section, STORE_LIMITS.appstore);

  const appId = await findApp();
  const buildId = await waitForBuild(appId, buildNumber);
  if (!buildId) throw new Error(`Build ${buildNumber} is still processing`);

  const v = await findOrCreateVersion(appId, version);
  const state = v?.attributes?.appStoreState;
  if (v && !EDITABLE.has(String(state))) {
    console.log(`Version ${version} is already ${state}; nothing to do.`);
    return;
  }
  if (v) {
    await setWhatsNew(v.id, notes);
    if (plan(`attach build ${buildNumber}`)) {
      const b = await asc(
        "PATCH",
        `/v1/appStoreVersions/${v.id}/relationships/build`,
        ref("builds", buildId),
      );
      expectStatus(b, [204], `Attach build ${buildNumber}`);
    }
    await submit(appId, v.id);
  } else {
    plan(`set What's New, attach build ${buildNumber}, submit for review`);
  }
  console.log(`\nWhat's New (${notes.length} characters):\n${notes}`);
  if (!dryRun)
    console.log(
      `✅ ${version} (${buildNumber}) submitted for App Store review.`,
    );
}

main().catch((e: Error) => {
  console.log(`::error::App Store submission failed: ${e.message}`);
  process.exitCode = 1;
});
