#!/usr/bin/env bun
// After altool uploads the build, wait for App Store Connect to finish
// processing, then add the build to the external beta group and submit it for
// Beta App Review — removing the manual "add to group + Submit for Review"
// two-step. Fail-soft: a successful upload is never failed by a distribution
// hiccup — problems are logged as warnings so the release stands and you can
// finish in the UI.
//
// Env: as asc.ts, plus BUILD_NUMBER. Optional: BETA_GROUP (default "Beta
// Testers").
//
// One-time prerequisite in App Store Connect, or Apple rejects the auto-submit:
// fill in Beta App Review Information (contact + demo account if login needed)
// and the group's "What to Test". External Beta App Review still takes Apple
// ~1–2 days per submission — this removes the clicks, not the wait.

import { asc, env, expectStatus, findApp, ref, waitForBuild } from "./asc";

async function main(): Promise<void> {
  const buildNumber = env("BUILD_NUMBER");
  const groupName = process.env.BETA_GROUP || "Beta Testers";

  const appId = await findApp();
  const buildId = await waitForBuild(appId, buildNumber);
  if (!buildId) {
    console.log(
      `::warning::Build ${buildNumber} still processing — finish distribution in App Store Connect or re-run.`,
    );
    return;
  }

  const groups = await asc(
    "GET",
    `/v1/betaGroups?filter[app]=${appId}&limit=200`,
  );
  const group = groups.data.find((g) => g.attributes?.name === groupName);
  if (!group) throw new Error(`External beta group "${groupName}" not found`);

  const add = await asc(
    "POST",
    `/v1/betaGroups/${group.id}/relationships/builds`,
    {
      data: [{ type: "builds", id: buildId }],
    },
  );
  expectStatus(add, [201, 204, 409], `Add to "${groupName}"`);
  console.log(`Build ${buildId} in "${groupName}".`);

  const sub = await asc("POST", "/v1/betaAppReviewSubmissions", {
    data: {
      type: "betaAppReviewSubmissions",
      relationships: { build: ref("builds", buildId) },
    },
  });
  expectStatus(sub, [201, 409], "Submit for Beta App Review");
  console.log(
    sub.status === 201
      ? "✅ Submitted for Beta App Review."
      : "Already submitted for Beta App Review.",
  );
}

main().catch((e: Error) => {
  // Never fail the release for a post-upload distribution problem — the build
  // is uploaded; surface a warning and let the user finish in the UI.
  console.log(`::warning::TestFlight auto-distribute skipped: ${e.message}`);
});
