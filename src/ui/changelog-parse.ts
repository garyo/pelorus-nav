/**
 * Minimal Keep-a-Changelog reader: pull one version's section out of
 * CHANGELOG.md so the "What's New" dialog can render just that release's
 * notes. Not a general Markdown parser — it understands exactly the shape we
 * author: `## [x.y.z] - date` headings, `### Group` subheads, and `-`/`*`
 * bullet items.
 */

export interface ChangelogGroup {
  /** Section label ("Added" / "Changed" / "Fixed"); "" for bullets with no
   *  subhead above them. */
  title: string;
  items: string[];
}

export interface ChangelogSection {
  version: string;
  /** ISO date from the heading (`YYYY-MM-DD`), or null if absent. */
  date: string | null;
  groups: ChangelogGroup[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract one version's section. Returns null when the version isn't present
 * or lists no items, so callers can simply skip showing anything.
 */
export function parseChangelogSection(
  markdown: string,
  version: string,
): ChangelogSection | null {
  const lines = markdown.split(/\r?\n/);
  const headRe = new RegExp(`^##\\s+\\[${escapeRegExp(version)}\\]`);
  let i = lines.findIndex((l) => headRe.test(l));
  if (i < 0) return null;

  const dateMatch = lines[i].match(/(\d{4}-\d{2}-\d{2})/);
  const section: ChangelogSection = {
    version,
    date: dateMatch ? dateMatch[1] : null,
    groups: [],
  };

  let group: ChangelogGroup | null = null;
  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // reached the next version

    const head = line.match(/^###\s+(.+?)\s*$/);
    if (head) {
      group = { title: head[1], items: [] };
      section.groups.push(group);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet) {
      if (!group) {
        group = { title: "", items: [] };
        section.groups.push(group);
      }
      group.items.push(bullet[1]);
      continue;
    }

    // A wrapped bullet: an indented non-empty line continues the item above it.
    const cont = line.trim();
    if (cont && group && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${cont}`;
    }
  }

  return section.groups.some((g) => g.items.length > 0) ? section : null;
}
