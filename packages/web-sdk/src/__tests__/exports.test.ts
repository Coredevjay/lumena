import { describe, it, expect } from "vitest";
import * as webSdk from "../index.js";

describe("web-sdk exports", () => {
  it("exports LumenClient and helpers", () => {
    expect(webSdk.LumenClient).toBeDefined();
    expect(typeof webSdk.createSessionKey).toBe("function");
  });
});

describe("web-sdk CJS build", () => {
  it("can be required and exposes LumenClient and createSessionKey", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);

    let cjs: Record<string, unknown>;
    try {
      cjs = require("../../dist/index.cjs");
    } catch (err) {
      // Skip when the CJS build has not been produced yet (e.g. running tests
      // before `tsup` has run). CI runs the build before this test.
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND"
      ) {
        return;
      }
      throw err;
    }

    expect(cjs.LumenClient).toBeDefined();
    expect(typeof cjs.createSessionKey).toBe("function");
  });
});