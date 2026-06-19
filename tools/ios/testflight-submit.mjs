// After altool uploads the build, wait for App Store Connect to finish
// processing, then add the build to the external beta group and submit it for
// Beta App Review — removing the manual "add to group + Submit for Review"
// two-step. Uses the App Store Connect API key the workflow already provides
// (no fastlane). Fail-soft: a successful upload is never failed by a
// distribution hiccup — problems are logged as warnings so the release stands
// and you can finish in the UI.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (.p8), BUNDLE_ID, BUILD_NUMBER.
// Optional: BETA_GROUP (default "Beta Testers").
//
// One-time prerequisite in App Store Connect, or Apple rejects the auto-submit:
// fill in Beta App Review Information (contact + demo account if login needed)
// and the group's "What to Test". External Beta App Review still takes Apple
// ~1–2 days per submission — this removes the clicks, not the wait.

import { createPrivateKey, sign as ecdsaSign } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://api.appstoreconnect.apple.com";
const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_KEY_PATH;
const BUNDLE_ID = process.env.BUNDLE_ID;
const BUILD_NUMBER = process.env.BUILD_NUMBER;
const GROUP_NAME = process.env.BETA_GROUP || "Beta Testers";
const PROCESS_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_MS = 30_000;

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// A fresh short-lived JWT per request — Apple caps lifetime at 20 min and this
// script may poll longer than that.
function jwt() {
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      iss: ISSUER_ID,
      iat: now,
      exp: now + 600,
      aud: "appstoreconnect-v1",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = createPrivateKey(readFileSync(KEY_PATH, "utf8"));
  // JOSE needs the raw R||S signature, not ASN.1/DER.
  const sig = ecdsaSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(sig)}`;
}

async function asc(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  for (const [k, v] of Object.entries({
    ASC_KEY_ID: KEY_ID,
    ASC_ISSUER_ID: ISSUER_ID,
    ASC_KEY_PATH: KEY_PATH,
    BUNDLE_ID,
    BUILD_NUMBER,
  })) {
    if (!v) throw new Error(`Missing required env ${k}`);
  }

  const apps = await asc(
    "GET",
    `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`,
  );
  const appId = apps.body?.data?.[0]?.id;
  if (!appId) throw new Error(`App not found for bundle ${BUNDLE_ID}`);

  // Wait for the just-uploaded build to finish processing.
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  let build;
  while (Date.now() < deadline) {
    const r = await asc(
      "GET",
      `/v1/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(BUILD_NUMBER)}&limit=1`,
    );
    build = r.body?.data?.[0];
    const state = build?.attributes?.processingState;
    if (state === "VALID") break;
    if (state === "INVALID" || state === "FAILED") {
      throw new Error(`Build ${BUILD_NUMBER} processing ${state}`);
    }
    console.log(
      `Build ${BUILD_NUMBER}: ${state ?? "not visible yet"} — waiting…`,
    );
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (build?.attributes?.processingState !== "VALID") {
    console.log(
      `::warning::Build ${BUILD_NUMBER} still processing after ${PROCESS_TIMEOUT_MS / 60000} min — finish distribution in App Store Connect or re-run.`,
    );
    return;
  }
  const buildId = build.id;

  const groups = await asc(
    "GET",
    `/v1/betaGroups?filter[app]=${appId}&limit=200`,
  );
  const group = groups.body?.data?.find(
    (g) => g.attributes?.name === GROUP_NAME,
  );
  if (!group) throw new Error(`External beta group "${GROUP_NAME}" not found`);

  const add = await asc(
    "POST",
    `/v1/betaGroups/${group.id}/relationships/builds`,
    {
      data: [{ type: "builds", id: buildId }],
    },
  );
  if (![201, 204, 409].includes(add.status)) {
    throw new Error(
      `Add to "${GROUP_NAME}" failed (${add.status}): ${JSON.stringify(add.body)}`,
    );
  }
  console.log(`Build ${buildId} in "${GROUP_NAME}".`);

  const sub = await asc("POST", "/v1/betaAppReviewSubmissions", {
    data: {
      type: "betaAppReviewSubmissions",
      relationships: { build: { data: { type: "builds", id: buildId } } },
    },
  });
  if (sub.status === 201) console.log("✅ Submitted for Beta App Review.");
  else if (sub.status === 409)
    console.log("Already submitted for Beta App Review.");
  else
    throw new Error(
      `Submit for review failed (${sub.status}): ${JSON.stringify(sub.body)}`,
    );
}

main().catch((e) => {
  // Never fail the release for a post-upload distribution problem — the build
  // is uploaded; surface a warning and let the user finish in the UI.
  console.log(`::warning::TestFlight auto-distribute skipped: ${e.message}`);
});
