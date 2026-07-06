import { describe, expect, it } from "vitest";
import { parseChangelogSection } from "./changelog-parse";

const SAMPLE = `# Changelog

Some intro text.

## [0.10.0] - 2026-07-05

### Added
- A new thing that
  wraps across two lines.

### Fixed
- Fixed a bug.
- Fixed another.

## [0.9.0] - 2026-07-01

### Fixed
- Older fix.
`;

describe("parseChangelogSection", () => {
  it("extracts the requested version's groups and items", () => {
    const s = parseChangelogSection(SAMPLE, "0.10.0");
    expect(s).not.toBeNull();
    expect(s?.version).toBe("0.10.0");
    expect(s?.date).toBe("2026-07-05");
    expect(s?.groups).toEqual([
      { title: "Added", items: ["A new thing that wraps across two lines."] },
      { title: "Fixed", items: ["Fixed a bug.", "Fixed another."] },
    ]);
  });

  it("stops at the next version heading", () => {
    const s = parseChangelogSection(SAMPLE, "0.9.0");
    expect(s?.groups).toEqual([{ title: "Fixed", items: ["Older fix."] }]);
  });

  it("returns null for a version that isn't present", () => {
    expect(parseChangelogSection(SAMPLE, "0.8.0")).toBeNull();
  });

  it("does not match a version that is a prefix of another", () => {
    // "0.1.0" must not match the "0.10.0" heading.
    expect(parseChangelogSection(SAMPLE, "0.1.0")).toBeNull();
  });

  it("returns null when the section has a heading but no items", () => {
    expect(parseChangelogSection("## [1.0.0] - 2026-01-01\n\n", "1.0.0")).toBe(
      null,
    );
  });

  it("collects bullets with no ### subhead into an untitled group", () => {
    const md = "## [2.0.0]\n- bare item\n- another\n";
    expect(parseChangelogSection(md, "2.0.0")?.groups).toEqual([
      { title: "", items: ["bare item", "another"] },
    ]);
  });
});
