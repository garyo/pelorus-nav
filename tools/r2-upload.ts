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
});

const fileSize = statSync(filePath).size;
const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);
console.log(`Uploading ${key} (${sizeMB} MiB) to ${bucket}...`);

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

try {
  await upload.done();
  console.log(`\n  ✓ Uploaded ${key}`);
} catch (err) {
  console.error(`\n  ✗ Upload failed: ${err}`);
  process.exit(1);
}
