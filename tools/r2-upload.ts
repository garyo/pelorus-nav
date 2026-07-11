#!/usr/bin/env bun

/**
 * Upload a file to Cloudflare R2 using the S3-compatible API.
 * Handles files of any size via automatic multipart upload.
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID  — Cloudflare account ID
 *   R2_ACCESS_KEY_ID       — R2 API token access key
 *   R2_SECRET_ACCESS_KEY   — R2 API token secret key
 *
 * Usage: bun tools/r2-upload.ts <bucket> <key> <file>
 */

import { createReadStream, statSync } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const [bucket, key, filePath] = process.argv.slice(2);

if (!bucket || !key || !filePath) {
  console.error("Usage: bun tools/r2-upload.ts <bucket> <key> <file>");
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error(
    "Missing env vars. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
  );
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  // Per-request retries within the SDK (individual part PUTs etc.)
  maxAttempts: 5,
});

const fileSize = statSync(filePath).size;
const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
console.log(`Uploading ${key} (${sizeMB} MiB) to ${bucket}...`);

// R2 occasionally answers a finished multipart upload with a transient
// "InternalError: We encountered an internal error. Please try again." —
// retry the whole file a few times before giving up so one hiccup doesn't
// kill a multi-hour nightly build. Each attempt needs a fresh Upload and a
// fresh read stream (both are single-use).
async function uploadOnce(): Promise<void> {
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: filePath.endsWith(".pmtiles")
        ? "application/octet-stream"
        : filePath.endsWith(".geojson")
          ? "application/geo+json"
          : "application/octet-stream",
    },
    // 50 MiB parts, up to 4 concurrent
    partSize: 50 * 1024 * 1024,
    queueSize: 4,
  });

  upload.on("httpUploadProgress", (progress) => {
    if (progress.loaded && fileSize > 0) {
      const pct = ((progress.loaded / fileSize) * 100).toFixed(0);
      process.stdout.write(
        `\r  ${pct}% (${(progress.loaded / (1024 * 1024)).toFixed(1)} MiB)`,
      );
    }
  });

  await upload.done();
}

const MAX_TRIES = 3;
for (let attempt = 1; ; attempt++) {
  try {
    await uploadOnce();
    console.log(`\n  ✓ Uploaded ${key}`);
    break;
  } catch (err) {
    console.error(`\n  ✗ Upload attempt ${attempt}/${MAX_TRIES} failed: ${err}`);
    if (attempt >= MAX_TRIES) {
      process.exit(1);
    }
    const delaySec = 15 * attempt;
    console.error(`  Retrying in ${delaySec}s...`);
    await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
  }
}
