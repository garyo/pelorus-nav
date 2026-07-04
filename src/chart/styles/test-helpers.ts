/**
 * Mini MapLibre expression evaluator for testing icon selection logic.
 *
 * Evaluates a subset of MapLibre expressions against feature properties.
 * Supports: case, match, ==, all, any, get, coalesce, in, to-string,
 * to-number, concat, index-of, slice, >=, +, literal, string constants.
 */

import { buildLayerExpressions, IHO_S52 } from "./icon-sets";

export type Props = Record<string, unknown>;

export function evalExpr(expr: unknown, props: Props): unknown {
  if (expr === undefined || expr === null) return expr;
  if (typeof expr === "string" || typeof expr === "number") return expr;
  if (typeof expr === "boolean") return expr;
  if (!Array.isArray(expr)) return expr;

  const [op, ...args] = expr;

  switch (op) {
    case "get":
      // MapLibre returns null (not undefined) for a missing property.
      return props[args[0] as string] ?? null;
    case "coalesce":
      for (const a of args) {
        const v = evalExpr(a, props);
        if (v != null) return v;
      }
      return null;
    case "to-string":
      return String(evalExpr(args[0], props) ?? "");
    case "to-number": {
      const v = evalExpr(args[0], props);
      const n = Number(v);
      return Number.isNaN(n)
        ? args.length > 1
          ? evalExpr(args[1], props)
          : 0
        : n;
    }
    case "concat":
      return args.map((a) => String(evalExpr(a, props) ?? "")).join("");
    case "index-of": {
      const needle = String(evalExpr(args[0], props));
      const haystack = String(evalExpr(args[1], props));
      return haystack.indexOf(needle);
    }
    case "slice": {
      const s = String(evalExpr(args[0], props));
      const start = Number(evalExpr(args[1], props));
      const end =
        args.length > 2 ? Number(evalExpr(args[2], props)) : undefined;
      return s.slice(start, end);
    }
    case "+":
      return args.reduce(
        (sum: number, a) => sum + Number(evalExpr(a, props)),
        0,
      );
    case ">=":
      return (
        Number(evalExpr(args[0], props)) >= Number(evalExpr(args[1], props))
      );
    case "==": {
      // MapLibre "==" is type-strict: comparing mismatched types is an
      // evaluation error on the real map, so it must fail tests too.
      const a = evalExpr(args[0], props);
      const b = evalExpr(args[1], props);
      if (a === null || b === null) return a === b;
      if (typeof a !== typeof b) {
        throw new Error(
          `"==" type mismatch: ${typeof a} vs ${typeof b} (${JSON.stringify(a)} vs ${JSON.stringify(b)}) — evaluation error on the real map`,
        );
      }
      return a === b;
    }
    case "in": {
      const needle = evalExpr(args[0], props);
      const haystack = evalExpr(args[1], props);
      if (Array.isArray(haystack)) {
        return haystack.includes(needle); // strict membership, like MapLibre
      }
      if (typeof haystack === "string") {
        if (typeof needle !== "string") {
          throw new Error(
            `"in" needle must be a string for a string haystack (got ${typeof needle}) — evaluation error on the real map`,
          );
        }
        return haystack.includes(needle);
      }
      throw new Error(
        `"in" haystack must be a string or array (got ${typeof haystack})`,
      );
    }
    case "all":
      return args.every((a) => evalExpr(a, props));
    case "any":
      return args.some((a) => evalExpr(a, props));
    case "literal":
      return args[0];
    case "case": {
      for (let i = 0; i < args.length - 1; i += 2) {
        if (evalExpr(args[i], props)) return evalExpr(args[i + 1], props);
      }
      return evalExpr(args[args.length - 1], props);
    }
    case "match": {
      // MapLibre "match" labels are literals (a primitive or an array of
      // primitives — never sub-expressions) and matching is type-strict: a
      // string input never matches a numeric label on the real map.
      const val = evalExpr(args[0], props);
      for (let i = 1; i < args.length - 1; i += 2) {
        const label = args[i];
        const hit = Array.isArray(label) ? label.includes(val) : label === val;
        if (hit) return evalExpr(args[i + 1], props);
      }
      return evalExpr(args[args.length - 1], props);
    }
    default:
      throw new Error(`Unsupported expression op: ${op}`);
  }
}

/** Resolve the icon sprite name for given layer + properties using S-52 icon set. */
export function resolveIcon(
  layerName: string,
  props: Props,
  iconSet = IHO_S52,
): string {
  const fallback = "FALLBACK";
  const { iconExpr } = buildLayerExpressions(layerName, iconSet, fallback);
  return String(evalExpr(iconExpr, props));
}
