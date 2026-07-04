/**
 * Expression helpers for S-57 list-typed attributes.
 *
 * The tile pipeline flattens every list-valued S-57 attribute (RESTRN,
 * CATSPM, COLOUR, CATOBS, CATLMK, FUNCTN, …) to a comma-separated string
 * (e.g. "8,27"); GDAL emits a plain scalar — string or NUMBER — for
 * single-valued features. MVT never carries JSON arrays (see CLAUDE.md).
 * These helpers are the sanctioned way to test such attributes:
 *
 * - Containment must be comma-padded: `",7,"` in `",8,27,"` — never a bare
 *   `"7"`, which false-matches "27"/"17"/"14".
 * - Numeric use must extract the FIRST element before `to-number` —
 *   `to-number` of "6,7" fails to its fallback, silently dropping the
 *   feature into default branches.
 * - Both must `to-string`+`coalesce` first: `concat` on a missing attribute
 *   or a numeric single is otherwise an expression evaluation error.
 */

/** ","+attr+"," as a string, tolerant of missing and numeric values. */
function padded(attr: string): unknown[] {
  return ["concat", ",", ["to-string", ["coalesce", ["get", attr], ""]], ","];
}

/** True when the list attribute `attr` contains exactly `code`. */
export function listAttrContains(
  attr: string,
  code: number | string,
): unknown[] {
  return ["in", `,${code},`, padded(attr)];
}

/**
 * First element of the list attribute as a number (0 when absent/invalid) —
 * S-57 convention treats the first value as primary.
 */
export function listAttrFirstNumber(attr: string): unknown[] {
  // Trailing comma guarantees index-of finds a delimiter for single values.
  const str = ["concat", ["to-string", ["coalesce", ["get", attr], ""]], ","];
  return ["to-number", ["slice", str, 0, ["index-of", ",", str]], 0];
}
