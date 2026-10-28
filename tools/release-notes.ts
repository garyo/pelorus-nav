#!/usr/bin/env bun
/**
 * Store release notes from CHANGELOG.md: one version's entry as plain text,
 * cut to a store's length limit.
 *
 *   bun tools/release-notes.ts <play|appstore> [version]
 *
 * The version defaults to package.json's. Google Play allows 500 characters
 * per language and the App Store 4000. Notes that don't fit keep the items
 * that do, in order, and end with a link to the full changelog.
 */

import { readFileSync } from "node:fs";
import {
  type ChangelogSection,
  parseChangelogSection,
} from "../src/ui/changelog-parse";

export const STORE_LIMITS = { play: 500, appstore: 4000 } as const;
export type Store = keyof typeof STORE_LIMITS;

export const CHANGELOG_URL =
  "https://github.com/garyo/pelorus-nav/blob/main/CHANGELOG.md";

/** Changelog Markdown (links, bold, italics, code) as plain text. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/** The section as plain-text notes of at most `limit` characters. */
export function storeNotes(section: ChangelogSection, limit: number): string {
  // The first `n` entries: preamble paragraphs, then items in order.
  const render = (n: number): string => {
    let left = n;
    const take = (xs: string[]) => {
      const kept = xs.slice(0, left);
      left -= kept.length;
      return kept;
    };
    const blocks = take(section.preamble).map(plainText);
    for (const g of section.groups) {
      const items = take(g.items).map((item) => `• ${plainText(item)}`);
      if (items.length > 0) {
        blocks.push((g.title ? [g.title, ...items] : items).join("\n"));
      }
    }
    return blocks.join("\n\n");
  };

  const total =
    section.preamble.length +
    section.groups.reduce((n, g) => n + g.items.length, 0);
  const full = render(total);
  if (full.length <= limit) return full;

  const more = `More: ${CHANGELOG_URL}`;
  for (let n = total - 1; n > 0; n--) {
    const notes = `${render(n)}\n\n${more}`;
    if (notes.length <= limit) return notes;
  }
  return more;
}

if (import.meta.main) {
  const store = process.argv[2] as Store;
  if (!(store in STORE_LIMITS)) {
    console.error(
      "usage: bun tools/release-notes.ts <play|appstore> [version]",
    );
    process.exit(2);
  }
  const version =
    process.argv[3] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
  const section = parseChangelogSection(
    readFileSync("CHANGELOG.md", "utf8"),
    version,
  );
  if (!section) {
    console.error(`CHANGELOG.md has no entry for ${version}`);
    process.exit(1);
  }
  process.stdout.write(storeNotes(section, STORE_LIMITS[store]));
}
