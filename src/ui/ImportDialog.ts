/**
 * The confirm step of a GPX import: what the file holds, what it matches on
 * this device, and where new items should be filed.
 *
 * It exists because importing is no longer a one-way "add everything" — a
 * synced file mostly matches what's already here, and the user deserves to
 * see that before writing rather than after. The folder field only appears
 * when there is something new to file and more than one of it: a single new
 * route is not clutter, and asking about it is noise.
 */

import type { GpxImportResult } from "../data/gpx";
import {
  defaultImportFolder,
  describeGpxContents,
  describeGpxUnchanged,
  type GpxImportPlan,
} from "../data/gpx-import";

export interface ImportChoice {
  /** Folder for newly added items; undefined leaves them unfiled. */
  folder?: string;
}

/** How many items the plan would add, across kinds. */
function addedCount(plan: GpxImportPlan): number {
  return (
    plan.routes.add.length + plan.tracks.add.length + plan.waypoints.add.length
  );
}

/** How many it would update. */
function updatedCount(plan: GpxImportPlan): number {
  return (
    plan.routes.update.length +
    plan.tracks.update.length +
    plan.waypoints.update.length
  );
}

/**
 * Show the import confirmation. Resolves with the user's choice, or null if
 * they cancelled — nothing is written either way; the caller does that.
 */
export function showImportDialog(
  result: GpxImportResult,
  plan: GpxImportPlan,
  fileName?: string | null,
): Promise<ImportChoice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card import-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = fileName ? `Import ${fileName}` : "Import GPX";
    card.appendChild(title);

    const body = document.createElement("div");
    body.className = "import-body";

    const contents = document.createElement("p");
    contents.textContent = `This file holds ${describeGpxContents(result)}.`;
    body.appendChild(contents);

    const unchanged = describeGpxUnchanged({
      routes: {
        added: 0,
        updated: 0,
        unchanged: plan.routes.unchanged.length,
      },
      tracks: {
        added: 0,
        updated: 0,
        unchanged: plan.tracks.unchanged.length,
      },
      waypoints: {
        added: 0,
        updated: 0,
        unchanged: plan.waypoints.unchanged.length,
      },
      skippedPoints: 0,
    });

    const added = addedCount(plan);
    const updated = updatedCount(plan);
    const notes: string[] = [];
    if (added > 0) notes.push(`${added} new`);
    if (updated > 0) notes.push(`${updated} already here and changed`);
    if (unchanged) notes.push(`${unchanged} already up to date`);
    if (notes.length > 0) {
      const detail = document.createElement("p");
      detail.className = "import-detail";
      detail.textContent = `${notes.join(", ")}.`;
      body.appendChild(detail);
    }

    // Nothing to file → no folder field, and the whole import is a no-op the
    // user can simply acknowledge.
    let folderInput: HTMLInputElement | null = null;
    if (added > 1) {
      const label = document.createElement("label");
      label.className = "import-folder";
      const text = document.createElement("span");
      text.textContent = "Put the new items in a folder";
      folderInput = document.createElement("input");
      folderInput.type = "text";
      folderInput.value = defaultImportFolder(result);
      folderInput.placeholder = "Leave empty to skip";
      label.append(text, folderInput);
      body.appendChild(label);
    }

    card.appendChild(body);

    const buttons = document.createElement("div");
    buttons.className = "import-buttons";

    const importBtn = document.createElement("button");
    importBtn.className = "import-btn primary";
    importBtn.textContent =
      added === 0 && updated === 0 ? "Nothing to import" : "Import";
    importBtn.disabled = added === 0 && updated === 0;
    importBtn.addEventListener("click", () => {
      close({ folder: folderInput?.value.trim() || undefined });
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "import-btn";
    cancelBtn.textContent = importBtn.disabled ? "Close" : "Cancel";
    cancelBtn.addEventListener("click", () => close(null));

    buttons.append(importBtn, cancelBtn);
    card.appendChild(buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Escape cancels; preventDefault keeps the global Escape fallback (nav
    // cancel, ContextMenu.ts) from firing behind the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(null);
    };
    document.addEventListener("keydown", onKey);

    (folderInput ?? importBtn).focus();
    folderInput?.select();

    function close(choice: ImportChoice | null): void {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(choice);
    }
  });
}
