import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Rebuild the module so its one-shot texture-size cache is fresh. */
async function load(
  maxTexture: number | null,
  screen?: [number, number, number],
) {
  vi.resetModules();
  const getParameter = vi.fn(() => maxTexture);
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: (kind: string) =>
        maxTexture === null || kind !== "webgl2"
          ? null
          : { MAX_TEXTURE_SIZE: 0x0d33, getParameter },
    }),
  });
  if (screen) {
    vi.stubGlobal("window", {
      devicePixelRatio: screen[2],
      screen: { width: screen[0], height: screen[1] },
    });
  }
  return await import("./gl-limits");
}

describe("gl-limits", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("lowers the canvas cap to a texture limit below MapLibre's default", async () => {
    // The reported case: Firefox on Linux, 2048 against a 2800px canvas.
    const { maxCanvasSize, maxTextureSize } = await load(2048);
    expect(maxTextureSize()).toBe(2048);
    expect(maxCanvasSize()).toEqual([2048, 2048]);
  });

  it("never raises the cap above MapLibre's default", async () => {
    const { maxCanvasSize } = await load(16384);
    expect(maxCanvasSize()).toEqual([4096, 4096]);
  });

  it("keeps the default when no context can be had", async () => {
    const { maxCanvasSize, maxTextureSize } = await load(null);
    expect(maxTextureSize()).toBeNull();
    expect(maxCanvasSize()).toEqual([4096, 4096]);
  });

  it("flags a screen that would have overflowed the limit", async () => {
    // 1400x800 at 2x is 2800 device px, past a 2048 limit.
    const { canvasWouldExceedTextureLimit } = await load(2048, [1400, 800, 2]);
    expect(canvasWouldExceedTextureLimit()).toBe(true);
  });

  it("does not flag a screen that fits", async () => {
    const { canvasWouldExceedTextureLimit } = await load(16384, [1400, 800, 2]);
    expect(canvasWouldExceedTextureLimit()).toBe(false);
  });

  it("does not flag when the limit is unknown", async () => {
    const { canvasWouldExceedTextureLimit } = await load(null, [1400, 800, 2]);
    expect(canvasWouldExceedTextureLimit()).toBe(false);
  });

  it("probes the driver only once", async () => {
    vi.resetModules();
    const getParameter = vi.fn(() => 2048);
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({ MAX_TEXTURE_SIZE: 0x0d33, getParameter }),
      }),
    });
    const { maxTextureSize } = await import("./gl-limits");
    maxTextureSize();
    maxTextureSize();
    maxTextureSize();
    expect(getParameter).toHaveBeenCalledTimes(1);
  });
});
