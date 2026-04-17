/**
 * Parse a hex color (#rgb, #rrggbb) into [r, g, b] 0-255.
 * Returns null if the string isn't a recognizable hex color.
 */
function parseHex(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, "");
  if (s.length === 3) {
    const r = Number.parseInt(s[0] + s[0], 16);
    const g = Number.parseInt(s[1] + s[1], 16);
    const b = Number.parseInt(s[2] + s[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  if (s.length === 6) {
    const r = Number.parseInt(s.slice(0, 2), 16);
    const g = Number.parseInt(s.slice(2, 4), 16);
    const b = Number.parseInt(s.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

function toHex(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, "0");
}

/**
 * Return a lighter shade of `hex` by mixing it toward white.
 * `amount` is 0 (no change) to 1 (white). Falls back to the input
 * string if the hex can't be parsed.
 */
export function lightenHex(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, amount));
  const [r, g, b] = rgb;
  return `#${toHex(r + (255 - r) * a)}${toHex(g + (255 - g) * a)}${toHex(b + (255 - b) * a)}`;
}
