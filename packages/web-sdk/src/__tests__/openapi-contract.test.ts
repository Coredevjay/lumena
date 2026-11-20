import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("web-sdk OpenAPI contract", () => {
  it("covers SDK HTTP entry points documented in openapi.yaml", () => {
    const spec = readFileSync(join(process.cwd(), "../../docs/openapi.yaml"), "utf8");
    const paths = ["/wallet/create", "/health", "/sponsor/status", "/policy/{walletId}"];
    for (const path of paths) {
      expect(spec).toContain(path);
    }
  });
});