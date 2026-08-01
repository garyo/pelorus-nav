/**
 * Floating panel for listing, editing, and deleting standalone waypoints.
 * Follows the RouteManagerPanel pattern.
 */

import {
  deleteWaypoint,
  deleteWaypoints,
  getAllWaypoints,
  saveWaypoint,
  saveWaypoints,
} from "../data/db";
import { downloadFile, GPX_MIME } from "../data/file-io";
import { waypointsToGpx } from "../data/gpx";
import type { StandaloneWaypoint, WaypointIcon } from "../data/Waypoint";
import type { WaypointLayer } from "../map/WaypointLayer";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import { getSettings, updateSettings } from "../settings";
import { importGpxFromPicker } from "./gpx-import";
import {
  iconCheckSquare,
  iconEdit,
  iconExport,
  iconEye,
  iconEyeOff,
  iconFolderOpen,
  iconNavigation,
  iconTrash,
  iconX,
  setIcon,
} from "./icons";
import { startInlineRename } from "./inline-rename";
import {
  createFolderRow,
  pruneCollapsed,
  toggleCollapsed,
} from "./manager-folder-row";
import { groupByFolder } from "./manager-folders";
import { ManagerSelection } from "./manager-selection";
import { getPanelStack } from "./PanelStack";
import { registerSurface } from "./SurfaceManager";
import { wireSortToggle } from "./sort-toggle";

const ICON_LABELS: Record<WaypointIcon, string> = {
  default: "Default",
  anchorage: "Anchorage",
  hazard: "Hazard",
  fuel: "Fuel",
  poi: "POI",
  cob: "COB / MOB",
};

/** Icons assignable in the edit dialog — "cob" is set only by the COB flow. */
const PICKABLE_ICONS: readonly WaypointIcon[] = [
  "default",
  "anchorage",
  "hazard",
  "fuel",
  "poi",
];

/** Hooks into the COB manager so deleting the active COB waypoint is never silent. */
export interface WaypointCobHooks {
  isCobWaypoint(id: string): boolean;
  noteWaypointDeleted(id: string): void;
}

export class WaypointManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly waypointLayer: WaypointLayer;
  private readonly activeNav: ActiveNavigationManager;
  /** True while an inline rename input is open. Suppresses refresh() so a
   *  background refresh can't destroy the input mid-edit and silently
   *  lose the rename. */
  private editing = false;
  private cobHooks: WaypointCobHooks | null = null;
  /** Row highlighted by openWithSelection (map tap-to-identify). */
  private selectedWaypointId: string | null = null;

  private readonly selection = new ManagerSelection<StandaloneWaypoint>({
    noun: "waypoint",
    surfaceId: "waypoint-selection",
    group: "waypoints",
    idOf: (wp) => wp.id,
    refresh: () => this.refresh(),
    setVisibleAll: async (wps, visible) => {
      const now = Date.now();
      for (const wp of wps) {
        wp.visible = visible;
        wp.updatedAt = now;
      }
      await saveWaypoints(wps);
    },
    setFolderAll: async (wps, folder) => {
      const now = Date.now();
      for (const wp of wps) {
        if (folder) wp.folder = folder;
        else delete wp.folder;
        wp.updatedAt = now;
      }
      await saveWaypoints(wps);
    },
    removeAll: async (wps) => {
      for (const wp of wps) {
        if (this.cobHooks?.isCobWaypoint(wp.id)) {
          this.cobHooks.noteWaypointDeleted(wp.id);
        }
        this.activeNav.noteWaypointDeleted(wp.id);
      }
      await deleteWaypoints(wps.map((wp) => wp.id));
    },
    allItems: () => getAllWaypoints(),
    folders: async () => [
      ...groupByFolder(await getAllWaypoints()).folders.keys(),
    ],
    afterBulkChange: async () => {
      await this.waypointLayer.reloadAll();
    },
  });

  constructor(
    waypointLayer: WaypointLayer,
    activeNav: ActiveNavigationManager,
  ) {
    this.waypointLayer = waypointLayer;
    this.activeNav = activeNav;

    // Stay in sync with any waypoint mutation (COB drop, Go To dialog,
    // context menu, drag-to-move) while open; refresh() already suppresses
    // itself during an inline rename.
    this.waypointLayer.onChange(() => {
      if (this.el.classList.contains("open")) this.refresh();
    });

    this.el = document.createElement("div");
    this.el.className = "manager-panel waypoint-manager-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Waypoints</span>" +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="manager-item-btn" id="wp-select-btn" title="Select several"></button>' +
      '<button class="manager-item-btn" id="wp-sort-btn"></button>' +
      '<button class="manager-item-btn" id="wp-import-btn" title="Import GPX"></button>' +
      '<button class="manager-item-btn" id="wp-export-all-btn" title="Export All GPX"></button>' +
      '<button class="manager-close"></button>' +
      "</div>" +
      "</div>" +
      '<div class="manager-body"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;

    const selectBtn = this.el.querySelector("#wp-select-btn") as HTMLElement;
    setIcon(selectBtn, iconCheckSquare);
    selectBtn.addEventListener("click", () => this.selection.toggleMode());

    wireSortToggle(this.el.querySelector("#wp-sort-btn") as HTMLElement, () =>
      this.refresh(),
    );

    const importBtn = this.el.querySelector("#wp-import-btn") as HTMLElement;
    setIcon(importBtn, iconFolderOpen);
    importBtn.addEventListener("click", () => {
      void importGpxFromPicker();
    });

    const exportAllBtn = this.el.querySelector(
      "#wp-export-all-btn",
    ) as HTMLElement;
    setIcon(exportAllBtn, iconExport);
    exportAllBtn.addEventListener("click", () => this.exportAll());

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    if (closeBtn) {
      setIcon(closeBtn, iconX);
      closeBtn.addEventListener("click", () => this.hide());
    }
  }

  setCobHooks(hooks: WaypointCobHooks): void {
    this.cobHooks = hooks;
  }

  private readonly surface = registerSurface({
    id: "waypoint-manager",
    slot: "top-right",
    group: "waypoints",
    // A workspace like the route panels: outside taps (pan/zoom while
    // reviewing waypoints) don't dismiss it. Closes via X, Escape, eviction.
    closeOnOutsideClick: false,
    el: () => this.el,
    isOpen: () => this.el.classList.contains("open"),
    close: () => this.hide(),
  });

  toggle(): void {
    if (this.el.classList.contains("open")) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.el.classList.add("open");
    this.surface.opened();
    // Defensive reset: guards against `editing` ever latching true (e.g. a
    // rename input removed from the DOM without firing `blur`), which would
    // otherwise freeze refresh() for the rest of the session.
    this.editing = false;
    this.refresh();
  }

  hide(): void {
    this.el.classList.remove("open");
    this.editing = false;
  }

  /** Open the panel with the given waypoint highlighted and scrolled into
   *  view (map tap-to-identify). */
  openWithSelection(waypointId: string): void {
    this.selectedWaypointId = waypointId;
    this.show(); // refresh() applies the row highlight
    this.body
      .querySelector(`.manager-item[data-waypoint-id="${waypointId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  refresh(): void {
    if (this.editing) return;
    const waypoints = this.waypointLayer.getWaypoints();

    if (waypoints.length === 0) {
      this.body.innerHTML = '<div class="manager-empty">No waypoints</div>';
      return;
    }

    const { ungrouped, folders } = groupByFolder(
      waypoints,
      getSettings().managerSort,
    );

    const stored = getSettings().collapsedWaypointFolders;
    const collapsed = pruneCollapsed(stored, folders);
    if (collapsed !== stored) {
      updateSettings({ collapsedWaypointFolders: [...collapsed] });
    }

    this.body.innerHTML = "";
    for (const wp of ungrouped) {
      this.body.appendChild(this.createWaypointItem(wp));
    }
    for (const [name, contents] of folders) {
      const isCollapsed = collapsed.includes(name);
      this.body.appendChild(
        createFolderRow({
          name,
          contents,
          isCollapsed,
          onToggleCollapse: (folder) => {
            updateSettings({
              collapsedWaypointFolders: toggleCollapsed(
                getSettings().collapsedWaypointFolders,
                folder,
              ),
            });
            this.refresh();
          },
          setVisible: (wps, visible) => this.setWaypointsVisible(wps, visible),
          decorateSelection: (contents, row) =>
            this.selection.decorateFolderRow(contents, row),
          refresh: async () => this.refresh(),
        }),
      );
      if (!isCollapsed) {
        for (const wp of contents) {
          this.body.appendChild(this.createWaypointItem(wp, true));
        }
      }
    }
  }

  /** Show or hide many waypoints: one write, one redraw. */
  private async setWaypointsVisible(
    wps: StandaloneWaypoint[],
    visible: boolean,
  ): Promise<void> {
    const now = Date.now();
    for (const wp of wps) {
      wp.visible = visible;
      wp.updatedAt = now;
    }
    await saveWaypoints(wps);
    await this.waypointLayer.reloadAll();
  }

  /** Show or hide one waypoint on the chart. No-op when already set, so a
   *  folder's bulk eye doesn't rewrite every record it touches. */
  private async setWaypointVisible(
    wp: StandaloneWaypoint,
    visible: boolean,
  ): Promise<void> {
    if (wp.visible === visible) return;
    wp.visible = visible;
    wp.updatedAt = Date.now();
    await this.waypointLayer.updateWaypoint(wp);
  }

  private createWaypointItem(
    wp: StandaloneWaypoint,
    inFolder = false,
  ): HTMLDivElement {
    const item = document.createElement("div");
    item.className = inFolder
      ? "manager-item manager-item--sub"
      : "manager-item";
    item.dataset.waypointId = wp.id;
    if (this.selectedWaypointId === wp.id) item.classList.add("selected");

    const iconDot = document.createElement("div");
    iconDot.className = "manager-item-color";
    iconDot.style.backgroundColor = this.iconColor(wp.icon);
    iconDot.title = ICON_LABELS[wp.icon];

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = wp.name;
    name.title = "Double-click to rename";
    name.style.cursor = "pointer";
    name.addEventListener("dblclick", () => this.rename(wp, name));

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    detail.textContent = wp.notes || ICON_LABELS[wp.icon];

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const navBtn = document.createElement("button");
    navBtn.className = "manager-item-btn";
    setIcon(navBtn, iconNavigation);
    navBtn.title = "Navigate to";
    navBtn.addEventListener("click", () => {
      this.activeNav.startGoto(wp);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "manager-item-btn";
    setIcon(editBtn, iconEdit);
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => {
      this.showEditDialog(wp);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manager-item-btn";
    setIcon(toggleBtn, wp.visible ? iconEye : iconEyeOff);
    toggleBtn.title = wp.visible ? "Hide" : "Show";
    toggleBtn.addEventListener("click", () => {
      (async () => {
        await this.setWaypointVisible(wp, !wp.visible);
        this.refresh();
      })().catch(console.error);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      const isCob = this.cobHooks?.isCobWaypoint(wp.id) ?? false;
      const prompt = isCob
        ? `"${wp.name}" is the active crew-overboard point. Deleting it ENDS the COB emergency. Delete anyway?`
        : `Delete waypoint "${wp.name}"?`;
      if (!confirm(prompt)) return;
      (async () => {
        if (isCob) this.cobHooks?.noteWaypointDeleted(wp.id);
        this.activeNav.noteWaypointDeleted(wp.id);
        await deleteWaypoint(wp.id);
        await this.waypointLayer.removeWaypoint(wp.id);
      })().catch(console.error);
    });

    actions.append(navBtn, editBtn, toggleBtn, deleteBtn);
    item.append(iconDot, info, actions);
    this.selection.track(wp);
    this.selection.decorateRow(wp, item, actions);
    return item;
  }

  private iconColor(icon: WaypointIcon): string {
    switch (icon) {
      case "anchorage":
        return "#3366cc";
      case "hazard":
        return "#cc2222";
      case "fuel":
        return "#228833";
      case "poi":
        return "#8833aa";
      case "cob":
        return "#dd1111";
      default:
        return "#ff8800";
    }
  }

  private rename(wp: StandaloneWaypoint, nameEl: HTMLDivElement): void {
    startInlineRename(nameEl, wp.name, {
      setEditing: (v) => {
        this.editing = v;
      },
      onCommit: async (newName) => {
        wp.name = newName;
        wp.updatedAt = Date.now();
        await saveWaypoint(wp);
        await this.waypointLayer.updateWaypoint(wp);
      },
      refresh: () => this.refresh(),
    });
  }

  private async exportAll(): Promise<void> {
    const waypoints = await getAllWaypoints();
    if (waypoints.length === 0) {
      alert("No waypoints to export.");
      return;
    }
    const gpx = waypointsToGpx(waypoints);
    downloadFile(gpx, "pelorus-waypoints.gpx", GPX_MIME);
  }

  private showEditDialog(wp: StandaloneWaypoint): void {
    // Simple inline edit: replace the item with an edit form
    const form = document.createElement("div");
    form.className = "waypoint-edit-form";
    form.innerHTML =
      '<label>Name <input type="text" class="wp-edit-name map-context-input" /></label>' +
      '<label>Notes <input type="text" class="wp-edit-notes map-context-input" /></label>' +
      '<label>Icon <select class="wp-edit-icon map-context-input"></select></label>' +
      '<div class="wp-edit-actions">' +
      '<button class="route-editor-btn wp-edit-save">Save</button>' +
      '<button class="route-editor-btn wp-edit-cancel">Cancel</button>' +
      "</div>";

    const nameInput = form.querySelector(".wp-edit-name") as HTMLInputElement;
    nameInput.value = wp.name;

    const notesInput = form.querySelector(".wp-edit-notes") as HTMLInputElement;
    notesInput.value = wp.notes;

    const iconSelect = form.querySelector(".wp-edit-icon") as HTMLSelectElement;
    // Offer pickable icons, plus the current one if it's special (e.g. "cob")
    // so editing a COB waypoint's name/notes doesn't force an icon change.
    const choices = PICKABLE_ICONS.includes(wp.icon)
      ? PICKABLE_ICONS
      : [wp.icon, ...PICKABLE_ICONS];
    for (const value of choices) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = ICON_LABELS[value];
      if (value === wp.icon) opt.selected = true;
      iconSelect.appendChild(opt);
    }

    const save = async () => {
      wp.name = nameInput.value.trim() || wp.name;
      wp.notes = notesInput.value.trim();
      wp.icon = iconSelect.value as WaypointIcon;
      wp.updatedAt = Date.now();
      await saveWaypoint(wp);
      await this.waypointLayer.updateWaypoint(wp);
    };

    form
      .querySelector(".wp-edit-save")
      ?.addEventListener("click", () => save().catch(console.error));
    form
      .querySelector(".wp-edit-cancel")
      ?.addEventListener("click", () => this.refresh());

    this.body.innerHTML = "";
    this.body.appendChild(form);
  }
}
