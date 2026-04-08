/**
 * Toolbar for the plotting layer. Appears at top-center when in plot mode.
 *
 * Two-row layout for stable button positions:
 *   Row 1 (tools):   [DR] [Fix] [EP] [R.Fix] [Text] [Brg] [Line]
 *   Row 2 (actions):  status/edit area  |  [Delete] [Clear] [Done]
 */

import type { PlotElement } from "./PlottingTypes";
import { PLOT_SHAPES, type PlotSymbolShape, SHAPE_LABELS } from "./plot-icons";

export type PlotTool =
  | "bearing"
  | "segment"
  | "current"
  | "arc"
  | "symbol"
  | "text"
  | "none";

/** Full names for symbol shape tooltips. */
const SHAPE_FULL_NAMES: Record<PlotSymbolShape, string> = {
  "half-circle": "Dead Reckoning",
  circle: "Fix",
  square: "Estimated Position",
  triangle: "Running Fix",
};

export interface PlotToolbarCallbacks {
  onToolSelect: (tool: PlotTool) => void;
  onSymbolShapeSelect: (shape: PlotSymbolShape) => void;
  onDelete: () => void;
  onClear: () => void;
  onDone: () => void;
  onEditElement: (id: string, changes: Record<string, string>) => void;
}

export class PlotToolbar {
  readonly element: HTMLDivElement;
  private activeTool: PlotTool = "none";
  private activeShape: PlotSymbolShape = "circle";
  private bearingBtn: HTMLButtonElement;
  private segmentBtn: HTMLButtonElement;
  private currentBtn: HTMLButtonElement;
  private lineMenuEl: HTMLDivElement;
  private lineBtn: HTMLButtonElement;
  private arcBtn!: HTMLButtonElement;
  private textBtn: HTMLButtonElement;
  private symbolBtns: Map<PlotSymbolShape, HTMLButtonElement> = new Map();
  private deleteBtn: HTMLButtonElement;
  private statusText: HTMLSpanElement;
  private editArea: HTMLDivElement;

  private readonly callbacks: PlotToolbarCallbacks;

  constructor(callbacks: PlotToolbarCallbacks) {
    this.callbacks = callbacks;

    this.element = document.createElement("div");
    this.element.className = "plot-toolbar";
    this.element.style.display = "none";

    // --- Row 1: tool buttons (fixed layout) ---
    const toolRow = document.createElement("div");
    toolRow.className = "plot-toolbar-row";

    for (const shape of PLOT_SHAPES) {
      const btn = this.makeBtn(
        SHAPE_LABELS[shape],
        () => {
          // Toggle off only if clicking the same shape; otherwise switch shape
          if (this.activeTool === "symbol" && this.activeShape === shape) {
            this.activeTool = "none";
          } else {
            this.activeShape = shape;
            this.activeTool = "symbol";
          }
          this.updateBtnStates();
          this.callbacks.onToolSelect(this.activeTool);
          callbacks.onSymbolShapeSelect(this.activeShape);
        },
        "plot-toolbar-btn--sym",
      );
      btn.title = SHAPE_FULL_NAMES[shape];
      this.symbolBtns.set(shape, btn);
      toolRow.appendChild(btn);
    }

    this.textBtn = this.makeBtn("Text", () => this.activateTool("text"));
    this.bearingBtn = this.makeBtn("Brg", () => this.activateTool("bearing"));
    this.bearingBtn.title = "Place bearing line";

    // Line button with dropdown: Free line or Current arrow
    const lineWrapper = document.createElement("div");
    lineWrapper.className = "plot-line-dropdown";
    this.lineBtn = this.makeBtn("Line \u25BE", () => this.toggleLineMenu());
    this.lineBtn.title = "Draw line or current arrow";
    this.lineMenuEl = document.createElement("div");
    this.lineMenuEl.className = "plot-line-menu";
    this.lineMenuEl.style.display = "none";
    this.segmentBtn = this.makeBtn("Free Line", () => {
      this.hideLineMenu();
      this.activateTool("segment");
    });
    this.currentBtn = this.makeBtn("Current", () => {
      this.hideLineMenu();
      this.activateTool("current");
    });
    this.currentBtn.title = "Set & drift arrow";
    this.lineMenuEl.append(this.segmentBtn, this.currentBtn);
    lineWrapper.append(this.lineBtn, this.lineMenuEl);

    this.arcBtn = this.makeBtn("Arc", () => this.activateTool("arc"));
    this.arcBtn.title = "Draw distance arc";
    toolRow.append(this.textBtn, this.bearingBtn, lineWrapper, this.arcBtn);

    // --- Row 2: status/edit + action buttons (fixed layout) ---
    const actionRow = document.createElement("div");
    actionRow.className = "plot-toolbar-row";

    // Left: status text and edit area share the same flex space
    this.statusText = document.createElement("span");
    this.statusText.className = "plot-toolbar-status";

    this.editArea = document.createElement("div");
    this.editArea.className = "plot-toolbar-edit";
    this.editArea.style.display = "none";

    const infoArea = document.createElement("div");
    infoArea.className = "plot-toolbar-info";
    infoArea.append(this.statusText, this.editArea);

    // Right: action buttons (always present, Delete grayed when nothing selected)
    this.deleteBtn = this.makeBtn(
      "Delete",
      callbacks.onDelete,
      "plot-toolbar-btn--danger",
    );
    this.deleteBtn.disabled = true;

    const clearBtn = this.makeBtn(
      "Clear",
      callbacks.onClear,
      "plot-toolbar-btn--danger",
    );
    const doneBtn = this.makeBtn(
      "Done",
      callbacks.onDone,
      "plot-toolbar-btn--secondary",
    );

    actionRow.append(infoArea, this.deleteBtn, clearBtn, doneBtn);

    this.element.append(toolRow, actionRow);
    document.body.appendChild(this.element);
  }

  show(): void {
    this.element.style.display = "flex";
  }

  hide(): void {
    this.element.style.display = "none";
    this.activeTool = "none";
    this.updateBtnStates();
    this.hideEditArea();
  }

  getTool(): PlotTool {
    return this.activeTool;
  }

  getActiveShape(): PlotSymbolShape {
    return this.activeShape;
  }

  setTool(tool: PlotTool): void {
    this.activeTool = tool;
    this.updateBtnStates();
  }

  setStatus(text: string): void {
    this.statusText.textContent = text;
    this.statusText.style.display = text ? "inline" : "none";
  }

  /** Enable/disable the delete button (always visible, grayed when disabled). */
  setDeleteVisible(hasSelection: boolean): void {
    this.deleteBtn.disabled = !hasSelection;
  }

  showEditControls(element: PlotElement): void {
    this.editArea.innerHTML = "";
    this.editArea.style.display = "flex";
    this.statusText.style.display = "none";

    if (element.type === "bearing-line") {
      this.editArea.appendChild(
        this.makeEditInput("Bearing", element.label, (val) => {
          this.callbacks.onEditElement(element.id, { bearing: val });
        }),
      );
    } else if (element.type === "segment-line" || element.type === "symbol") {
      this.editArea.appendChild(
        this.makeEditInput("Label", element.label, (val) => {
          this.callbacks.onEditElement(element.id, { label: val });
        }),
      );
    } else if (element.type === "current-arrow") {
      this.editArea.appendChild(
        this.makeEditInput("Set", element.setTrue.toFixed(0), (val) => {
          this.callbacks.onEditElement(element.id, { set: val });
        }),
      );
      this.editArea.appendChild(
        this.makeEditInput("Drift", element.driftKnots.toFixed(1), (val) => {
          this.callbacks.onEditElement(element.id, { drift: val });
        }),
      );
    } else if (element.type === "distance-arc") {
      this.editArea.appendChild(
        this.makeEditInput(
          "Radius",
          this.formatRadius(element.radiusNM),
          (val) => {
            this.callbacks.onEditElement(element.id, { radius: val });
          },
        ),
      );
    } else if (element.type === "text") {
      this.editArea.appendChild(
        this.makeEditInput("Text", element.text, (val) => {
          this.callbacks.onEditElement(element.id, { text: val });
        }),
      );
    }
  }

  hideEditArea(): void {
    this.editArea.style.display = "none";
    this.editArea.innerHTML = "";
  }

  destroy(): void {
    this.element.remove();
  }

  /** Activate a tool, or toggle it off if already active (returns to select mode). */
  private activateTool(tool: PlotTool): void {
    this.activeTool = this.activeTool === tool ? "none" : tool;
    this.updateBtnStates();
    this.callbacks.onToolSelect(this.activeTool);
  }

  private toggleLineMenu(): void {
    const visible = this.lineMenuEl.style.display !== "none";
    this.lineMenuEl.style.display = visible ? "none" : "flex";
  }

  private hideLineMenu(): void {
    this.lineMenuEl.style.display = "none";
  }

  private updateBtnStates(): void {
    this.bearingBtn.classList.toggle("active", this.activeTool === "bearing");
    const lineActive =
      this.activeTool === "segment" || this.activeTool === "current";
    this.lineBtn.classList.toggle("active", lineActive);
    this.segmentBtn.classList.toggle("active", this.activeTool === "segment");
    this.currentBtn.classList.toggle("active", this.activeTool === "current");
    this.arcBtn.classList.toggle("active", this.activeTool === "arc");
    this.textBtn.classList.toggle("active", this.activeTool === "text");
    this.hideLineMenu();
    for (const [shape, btn] of this.symbolBtns) {
      btn.classList.toggle(
        "active",
        this.activeTool === "symbol" && this.activeShape === shape,
      );
    }
  }

  private makeBtn(
    label: string,
    onClick: () => void,
    extraClass?: string,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `plot-toolbar-btn${extraClass ? ` ${extraClass}` : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Format radius for display in edit field (e.g. "1.5nm", "500ft"). */
  private formatRadius(nm: number): string {
    if (nm < 0.1) {
      return `${Math.round(nm * 6076.12)}ft`;
    }
    return `${nm.toFixed(2)}nm`;
  }

  private makeEditInput(
    placeholder: string,
    value: string,
    onSubmit: (val: string) => void,
  ): HTMLDivElement {
    const wrapper = document.createElement("div");
    wrapper.className = "plot-edit-field";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "plot-bearing-field";
    input.placeholder = placeholder;
    input.value = value;
    input.style.width = "100px";

    let submitted = false;
    const submit = () => {
      if (submitted) return;
      submitted = true;
      onSubmit(input.value);
      // Allow re-submission after a tick (in case user re-focuses and edits again)
      setTimeout(() => {
        submitted = false;
      }, 0);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      e.stopPropagation();
    });

    input.addEventListener("blur", () => {
      submit();
    });

    wrapper.appendChild(input);
    return wrapper;
  }
}
