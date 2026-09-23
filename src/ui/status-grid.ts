/**
 * Rows for the diagnostics panels' status grids (`.sat-status`): a label, a
 * value with an optional traffic-light dot, and a slot for an inline action.
 */

export type DotState = "green" | "amber" | "red" | "off";

export interface StatusRow {
  dot: HTMLElement;
  text: HTMLElement;
  action: HTMLElement;
  /** All grid cells of the row, for hiding it entirely. */
  cells: HTMLElement[];
}

export function addStatusRow(grid: HTMLElement, label: string): StatusRow {
  const labelEl = document.createElement("div");
  labelEl.className = "sat-status-label";
  labelEl.textContent = label;

  const value = document.createElement("div");
  value.className = "sat-status-value";
  const dot = document.createElement("span");
  dot.className = "sat-dot";
  const text = document.createElement("span");
  value.append(dot, text);

  const action = document.createElement("div");
  action.className = "sat-status-action";

  grid.append(labelEl, value, action);
  return { dot, text, action, cells: [labelEl, value, action] };
}

/** Set a row's dot and text, writing only on change (e-ink refreshes). */
export function setStatusRow(
  row: StatusRow,
  dot: DotState,
  text: string,
): void {
  const dotClass = dot === "off" ? "sat-dot" : `sat-dot sat-dot-${dot}`;
  if (row.dot.className !== dotClass) row.dot.className = dotClass;
  if (row.text.textContent !== text) row.text.textContent = text;
}

export function setStatusRowVisible(row: StatusRow, visible: boolean): void {
  const display = visible ? "" : "none";
  for (const cell of row.cells) {
    if (cell.style.display !== display) cell.style.display = display;
  }
}
