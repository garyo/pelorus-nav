/**
 * App Store Connect API client for the iOS release scripts (no fastlane):
 * JWT auth with the API key the iOS workflow provides, and the lookups the
 * scripts share.
 *
 * Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (.p8), BUNDLE_ID.
 */

import { createPrivateKey, sign as ecdsaSign } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://api.appstoreconnect.apple.com";
const PROCESS_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_MS = 30_000;

export interface Resource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}

export interface Response {
  status: number;
  data: Resource[];
  /** The raw body, for error messages. */
  text: string;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

// A fresh short-lived JWT per request: Apple caps lifetime at 20 min and the
// scripts may poll longer than that.
function jwt(): string {
  const header = b64url(
    JSON.stringify({ alg: "ES256", kid: env("ASC_KEY_ID"), typ: "JWT" }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      iss: env("ASC_ISSUER_ID"),
      iat: now,
      exp: now + 600,
      aud: "appstoreconnect-v1",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = createPrivateKey(readFileSync(env("ASC_KEY_PATH"), "utf8"));
  // JOSE needs the raw R||S signature, not ASN.1/DER.
  const sig = ecdsaSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(sig)}`;
}

/** One API call; `data` is always a list (empty for no body or errors). */
export async function asc(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as { data?: unknown }).data : null;
  return {
    status: res.status,
    data: Array.isArray(data) ? data : data ? [data as Resource] : [],
    text,
  };
}

/** Throws unless the response has one of the `ok` statuses. */
export function expectStatus(r: Response, ok: number[], what: string): void {
  if (!ok.includes(r.status)) {
    throw new Error(`${what} failed (${r.status}): ${r.text}`);
  }
}

/** A JSON:API relationship body naming one resource. */
export const ref = (type: string, id: string) => ({ data: { type, id } });

export async function findApp(): Promise<string> {
  const bundleId = env("BUNDLE_ID");
  const r = await asc(
    "GET",
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
  );
  expectStatus(r, [200], "App lookup");
  const app = r.data[0];
  if (!app) throw new Error(`App not found for bundle ${bundleId}`);
  return app.id;
}

/**
 * The build's id once App Store Connect has finished processing it, or null
 * if it is still processing after the timeout.
 */
export async function waitForBuild(
  appId: string,
  buildNumber: string,
): Promise<string | null> {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await asc(
      "GET",
      `/v1/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildNumber)}&limit=1`,
    );
    const build = r.data[0];
    const state = build?.attributes?.processingState;
    if (build && state === "VALID") return build.id;
    if (state === "INVALID" || state === "FAILED") {
      throw new Error(`Build ${buildNumber} processing ${state}`);
    }
    console.log(
      `Build ${buildNumber}: ${state ?? "not visible yet"}, waiting…`,
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}
