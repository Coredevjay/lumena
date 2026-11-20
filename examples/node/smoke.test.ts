import { describe, it, expect } from "vitest";

describe("node example smoke", () => {
  it("loads the entry module", async () => {
    const mod = await import("./index.ts");
    expect(mod).toBeTruthy();
  });
});