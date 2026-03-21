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
      return props[args[0] as string];
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
    case "==":
      // biome-ignore lint/suspicious/noDoubleEquals: MapLibre loose equality
      return evalExpr(args[0], props) == evalExpr(args[1], props);
    case "in": {
      const needle = String(evalExpr(args[0], props));
      const haystack = String(evalExpr(args[1], props));
      return haystack.includes(needle);
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
      const val = evalExpr(args[0], props);
      for (let i = 1; i < args.length - 1; i += 2) {
        const matchVal = evalExpr(args[i], props);
        // biome-ignore lint/suspicious/noDoubleEquals: MapLibre loose equality
        if (val == matchVal) return evalExpr(args[i + 1], props);
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
