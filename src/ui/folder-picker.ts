/**
 * "Which folder?" as a dialog, for acting on several items at once.
 *
 * The route detail panel asks this with a native `<select>`, which suits one
 * item in a fixed footer. A bulk action has no such anchor — it fires from a
 * floating bar — so it asks with the card dialog the app uses elsewhere, where
 * every choice is a full-width touch target.
 */

export interface FolderChoice {
  /** Chosen folder, or undefined for "no folder". */
  folder?: string;
}

/**
 * Pick a folder from those in use, or make a new one. Resolves null if the
 * user cancels.
 */
export function showFolderPicker(
  folders: readonly string[],
  count: number,
  noun: string,
): Promise<FolderChoice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card folder-picker-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = `Move ${count} ${noun}${count === 1 ? "" : "s"} to…`;
    card.appendChild(title);

    const list = document.createElement("div");
    list.className = "folder-picker-list";

    const choice = (label: string, onPick: () => void, extra = "") => {
      const btn = document.createElement("button");
      btn.className = `folder-picker-choice${extra ? ` ${extra}` : ""}`;
      btn.textContent = label;
      btn.addEventListener("click", onPick);
      list.appendChild(btn);
    };

    for (const name of folders) {
      choice(name, () => close({ folder: name }));
    }
    choice("New folder…", () => {
      const name = prompt("New folder name:")?.trim();
      if (name) close({ folder: name });
    });
    choice("No folder", () => close({}), "folder-picker-none");

    card.appendChild(list);

    const buttons = document.createElement("div");
    buttons.className = "import-buttons";
    const cancel = document.createElement("button");
    cancel.className = "import-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => close(null));
    buttons.appendChild(cancel);
    card.appendChild(buttons);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Escape cancels; preventDefault keeps the global Escape fallback from
    // firing behind the dialog (see ContextMenu.ts).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(null);
    };
    document.addEventListener("keydown", onKey);

    function close(result: FolderChoice | null): void {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }
  });
}
