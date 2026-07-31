/**
 * The .gpx file association lives entirely in the native manifests, so nothing
 * in the app fails if it goes missing — "Open with" just silently stops
 * offering Pelorus. These assertions make an accidental drop (a `cap sync`, an
 * Xcode edit, a merge) fail the build instead.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("iOS Info.plist", () => {
  const plist = read("ios/App/App/Info.plist");

  it("imports the GPX uniform type", () => {
    expect(plist).toContain("UTImportedTypeDeclarations");
    expect(plist).toContain("com.topografix.gpx");
    // Conforming to public.xml is what makes the type resolvable at all.
    expect(plist).toContain("public.xml");
  });

  it("declares GPX as a document type it can open", () => {
    expect(plist).toContain("CFBundleDocumentTypes");
    expect(plist).toContain("LSItemContentTypes");
  });

  it("keeps the Files-app integration the import flow depends on", () => {
    expect(plist).toContain("LSSupportsOpeningDocumentsInPlace");
    expect(plist).toContain("UIFileSharingEnabled");
  });
});

describe("AndroidManifest.xml", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");

  it("handles VIEW intents for GPX media types", () => {
    expect(manifest).toContain("android.intent.action.VIEW");
    expect(manifest).toContain('android:mimeType="application/gpx+xml"');
  });

  it("accepts the generic type cloud providers report", () => {
    // Drive and Gmail hand back octet-stream with no filename in the URI;
    // without this Pelorus never appears in their "Open with".
    expect(manifest).toContain('android:mimeType="application/octet-stream"');
  });

  it("matches .gpx by path for legacy file:// senders", () => {
    expect(manifest).toContain('android:pathPattern=".*\\\\.gpx"');
  });
});
