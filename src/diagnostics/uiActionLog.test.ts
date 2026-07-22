import { describe, expect, it } from "vitest";
import { getMode, setMode } from "../map/InteractionMode";
import { logUiAction, uiActionLog } from "./uiActionLog";

describe("uiActionLog", () => {
  it("records actions with detail", () => {
    uiActionLog.clear();
    logUiAction("open routes");
    expect(uiActionLog.entryCount).toBe(1);
    expect(uiActionLog.getEntries()[0].detail).toBe("open routes");
  });

  it("records interaction-mode transitions", () => {
    const initial = getMode();
    uiActionLog.clear();
    setMode("route-edit");
    expect(uiActionLog.getEntries().map((e) => e.detail)).toContain(
      `mode ${initial} -> route-edit`,
    );
    setMode(initial);
  });
});
