import { describe, expect, it } from "vitest";
import type { ChangelogSection } from "../src/ui/changelog-parse";
import { CHANGELOG_URL, plainText, storeNotes } from "./release-notes";

/** Long enough that leaving it out makes room for the changelog link. */
const LONG = "much longer ".repeat(10).trim();

const SECTION: ChangelogSection = {
  version: "1.1.0",
  date: "2026-10-28",
  preamble: [],
  groups: [
    { title: "Added", items: ["A **new** layer."] },
    { title: "Fixed", items: ["First fix.", `Second fix, \`${LONG}\`.`] },
  ],
};

describe("plainText", () => {
  it("strips links, emphasis and code", () => {
    expect(
      plainText("See [the guide](https://x.y/z), **bold**, *it* and `a.b`."),
    ).toBe("See the guide, bold, it and a.b.");
  });
});

describe("storeNotes", () => {
  it("lists every item under its heading when the notes fit", () => {
    expect(storeNotes(SECTION, 500)).toBe(
      `Added\n• A new layer.\n\nFixed\n• First fix.\n• Second fix, ${LONG}.`,
    );
  });

  it("keeps the leading items that fit and links the full changelog", () => {
    const more = `More: ${CHANGELOG_URL}`;
    const two = `Added\n• A new layer.\n\nFixed\n• First fix.\n\n${more}`;
    expect(storeNotes(SECTION, two.length)).toBe(two);
    expect(storeNotes(SECTION, two.length - 1)).toBe(
      `Added\n• A new layer.\n\n${more}`,
    );
  });

  it("puts the preamble first and lists items without a heading bare", () => {
    const s: ChangelogSection = {
      ...SECTION,
      preamble: ["Out of beta."],
      groups: [{ title: "", items: ["One."] }],
    };
    expect(storeNotes(s, 500)).toBe("Out of beta.\n\n• One.");
  });
});
