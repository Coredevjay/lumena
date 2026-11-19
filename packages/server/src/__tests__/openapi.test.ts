import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openApiSpec } from "../openapi.js";

describe("OpenAPI Specification", () => {
  it("defines openapi version 3.0.3", () => {
    expect(openApiSpec.openapi).toBe("3.0.3");
  });

  it("contains all required server endpoints", () => {
    const paths = Object.keys(openApiSpec.paths);
    expect(paths).toContain("/health");
    expect(paths).toContain("/cosign");
    expect(paths).toContain("/fee-bump");
    expect(paths).toContain("/fee-bump/submit");
    expect(paths).toContain("/wallet/create");
    expect(paths).toContain("/wallet/{address}/transactions");
    expect(paths).toContain("/wallet/{address}/balance");
    expect(paths).toContain("/policy");
    expect(paths).toContain("/policy/{walletId}");
    expect(openApiSpec.paths["/policy/{walletId}"]).toHaveProperty("put");
    expect(openApiSpec.paths["/policy/{walletId}"]).toHaveProperty("delete");
  });

  it("defines the health details endpoint", () => {
    expect(openApiSpec.paths).toHaveProperty("/health/details");
    expect(openApiSpec.paths["/health/details"]).toHaveProperty("get");
  });

  it("defines the wallet metadata PATCH endpoint", () => {
    expect(openApiSpec.paths).toHaveProperty("/wallets/{address}");
    expect(openApiSpec.paths["/wallets/{address}"]).toHaveProperty("patch");
  });

  it("defines the webhook DLQ inspection and replay endpoints", () => {
    expect(openApiSpec.paths).toHaveProperty("/webhooks/dlq");
    expect(openApiSpec.paths["/webhooks/dlq"]).toHaveProperty("get");
    expect(openApiSpec.paths).toHaveProperty("/webhooks/dlq/{id}/replay");
    expect(openApiSpec.paths["/webhooks/dlq/{id}/replay"]).toHaveProperty("post");
  });

  it("declares only a status property on the public health response", () => {
    const healthGet = openApiSpec.paths["/health"].get;
    const response = healthGet.responses["200"];
    const schema = response.content["application/json"].schema;
    expect(schema).toHaveProperty("properties");
    expect(Object.keys(schema.properties)).toEqual(["status"]);
  });

  it("defines valid request and response schemas", () => {
    expect(openApiSpec.components.schemas).toHaveProperty("SpendLimitRule");
    expect(openApiSpec.components.schemas).toHaveProperty("VelocityRule");
    expect(openApiSpec.components.schemas).toHaveProperty("AllowlistRule");
    expect(openApiSpec.components.schemas).toHaveProperty("MaxOperationsRule");
    expect(openApiSpec.components.schemas).toHaveProperty("Policy");
  });

  it("defines bearerAuth security scheme and security requirement", () => {
    expect(openApiSpec.components.securitySchemes).toHaveProperty("bearerAuth");
    expect(openApiSpec.security).toContainEqual({ bearerAuth: [] });
  });

  it("matches the published docs/openapi.yaml version", () => {
    const yaml = readFileSync(
      fileURLToPath(new URL("../../../../docs/openapi.yaml", import.meta.url)),
      "utf8",
    );
    expect(yaml.match(/^openapi:\s*(\S+)/m)?.[1]).toBe(openApiSpec.openapi);
    expect(yaml.match(/^  version:\s*(\S+)/m)?.[1]).toBe(openApiSpec.info.version);
  });
});