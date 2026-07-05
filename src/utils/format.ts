/**
 * Compact display formatters shared by track UI (list rows, viewer panel)
 * and by anything reporting on-disk/storage sizes (chart cache, diagnostics).
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

/** Format a Date as "YYYY-MM-DD HH:MM" in local time — used to name
 *  auto-created routes and tracks. */
export function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "512 B", "48 KB", "12.3 MB", "1.20 GB" — binary (1024-based) units, since
 *  every caller ultimately reports storage-API/filesystem sizes (OPFS chart
 *  files, `navigator.storage.estimate()`), which browsers already surface in
 *  binary units (e.g. Chrome's own storage UI). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
