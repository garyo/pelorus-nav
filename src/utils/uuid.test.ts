import { afterEach, describe, expect, it, vi } from "vitest";
import { generateUUID } from "./uuid";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUUID", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a well-formed v4 UUID via crypto.randomUUID", () => {
    expect(generateUUID()).toMatch(UUID_V4_RE);
  });

  describe("fallback path (no crypto.randomUUID)", () => {
    function stubInsecureCrypto(): void {
      const realCrypto = globalThis.crypto;
      vi.stubGlobal("crypto", {
        getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
      });
    }

    it("produces well-formed v4 UUIDs", () => {
      stubInsecureCrypto();
      expect(crypto.randomUUID).toBeUndefined();
      for (let i = 0; i < 50; i++) {
        expect(generateUUID()).toMatch(UUID_V4_RE);
      }
    });

    it("sets the version nibble to 4 and the variant bits to 10xx", () => {
      stubInsecureCrypto();
      const id = generateUUID();
      expect(id[14]).toBe("4");
      expect("89ab").toContain(id[19]);
    });

    it("returns distinct values on successive calls", () => {
      stubInsecureCrypto();
      expect(generateUUID()).not.toBe(generateUUID());
    });
  });
});
