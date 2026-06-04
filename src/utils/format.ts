/**
 * Compact display formatters shared by track UI (list rows, viewer panel).
 */

/** "47s", "12m", "1h 47m", "23h 8m" — compact, sortable-feeling. */
export function formatDurationShort(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hours}h` : `${hours}h ${min}m`;
}

/** "0.30 nm", "12.4 nm", "127 nm". */
export function formatDistanceShort(nm: number): string {
  if (nm < 0) nm = 0;
  if (nm < 10) return `${nm.toFixed(2)} nm`;
  if (nm < 100) return `${nm.toFixed(1)} nm`;
  return `${Math.round(nm)} nm`;
}
