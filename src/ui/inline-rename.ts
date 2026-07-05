/**
 * Shared inline-rename machinery for the track/route/waypoint manager panels.
 * Replaces a label element with a text input, committing the new value on
 * blur/Enter and reverting on Escape. `setEditing` lets each panel latch an
 * `editing` flag for the duration of the edit, so a background refresh()
 * (or a trivial-item cleanup) can't yank the input out from under the user —
 * see TrackManagerPanel.test.ts for the regression this guards against.
 */
export interface InlineRenameOptions {
  /** Called synchronously as editing starts (true) and again once the
   *  input is done with (false) — before the commit's async work runs, so
   *  latch-clearing timing matches a plain inline `editing = false`. */
  setEditing: (editing: boolean) => void;
  /** Persist the new name (and any related side effects, e.g. updating a
   *  layer). Skipped only in the sense that an unchanged value still calls
   *  this — same as the prior per-panel implementations. */
  onCommit: (newName: string) => void | Promise<void>;
  /** Re-render the list after the commit settles. */
  refresh: () => void;
}

/** Swap `nameEl` for a text input pre-filled with `currentName`, wired for
 *  commit-on-blur/Enter and cancel-on-Escape. */
export function startInlineRename(
  nameEl: HTMLElement,
  currentName: string,
  options: InlineRenameOptions,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "map-context-input";
  input.style.margin = "0";
  input.style.width = "100%";
  nameEl.replaceWith(input);
  options.setEditing(true);
  input.focus();
  input.select();

  const finish = async () => {
    options.setEditing(false);
    const newName = input.value.trim() || currentName;
    await options.onCommit(newName);
    options.refresh();
  };

  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      e.preventDefault(); // cancel the rename only — not navigation
      input.value = currentName;
      input.blur();
    }
  });
}
