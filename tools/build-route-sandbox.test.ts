import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRouteSandbox, ROUTE_SANDBOX_ASSETS } from "./build-route-sandbox";

describe("route sandbox bundle", () => {
  it.each(
    ROUTE_SANDBOX_ASSETS,
  )("%s is rebuilt from source (bun tools/build-route-sandbox.ts)", async (path) => {
    expect(readFileSync(path, "utf8")).toBe(await buildRouteSandbox());
  });

  it("exposes the route follower as a global, as the service calls it", async () => {
    const sandbox: { pelorusRoute?: Record<string, unknown> } = {};
    new Function(
      "globalThis",
      `${await buildRouteSandbox()};globalThis.pelorusRoute=pelorusRoute;`,
    )(sandbox);
    expect(typeof sandbox.pelorusRoute?.setRoute).toBe("function");
    expect(typeof sandbox.pelorusRoute?.onFix).toBe("function");
  });
});
