import { describe, it, expect } from "vitest";
import { z } from "zod";
import { openApiSpec } from "../openapi.js";
import { PolicyRequestSchema } from "../validation.js";

/**
 * Snapshots of the public API contracts. A failing test here means the schema
 * changed; see docs/CI.md ("Schema Snapshots") for how to update them.
 */
describe("schema snapshots", () => {
  it("matches the OpenAPI spec snapshot", async () => {
    await expect(`${JSON.stringify(openApiSpec, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/openapi.json",
    );
  });

  it("matches the policy JSON schema snapshot", async () => {
    const schema = z.toJSONSchema(PolicyRequestSchema);
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/policy.schema.json",
    );
  });
});
