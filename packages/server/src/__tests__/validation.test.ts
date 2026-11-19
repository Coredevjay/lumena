import { describe, it, expect } from "vitest";
import {
  CosignRequestSchema,
  FeeBumpRequestSchema,
  PolicyRequestSchema,
  WalletPatchSchema,
} from "../validation.js";

describe("validation schemas", () => {
  it("validates valid cosign requests", () => {
    const valid = {
      xdr: "AAAA...",
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    };
    const result = CosignRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid cosign requests", () => {
    const invalid = { xdr: "" };
    const result = CosignRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects cosign requests with invalid Stellar public key", () => {
    const invalidAddress = {
      xdr: "AAAA...",
      walletAddress: "not-a-valid-stellar-address",
    };
    const result = CosignRequestSchema.safeParse(invalidAddress);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.walletAddress).toContain(
        "walletAddress must be a valid Stellar public key",
      );
    }
  });

  it("rejects cosign requests with malformed public key starting with G", () => {
    const invalidAddress = {
      xdr: "AAAA...",
      walletAddress: "GBADCHECKSUMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const result = CosignRequestSchema.safeParse(invalidAddress);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.walletAddress).toContain(
        "walletAddress must be a valid Stellar public key",
      );
    }
  });

  it("validates valid fee bump requests", () => {
    const valid = { xdr: "AAAA..." };
    const result = FeeBumpRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("validates policy requests", () => {
    const valid = {
      walletId: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      rules: [
        {
          type: "spend_limit",
          asset: "native",
          maxPerTx: "100",
          maxDaily: "500",
        },
      ],
    };
    const result = PolicyRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("validates blocklist policy rules", () => {
    const result = PolicyRequestSchema.safeParse({
      walletId: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      rules: [
        {
          type: "blocklist",
          destinations: ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates asset allowlist policy rules", () => {
    const result = PolicyRequestSchema.safeParse({
      walletId: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      rules: [{ type: "asset_allowlist", assets: ["native", "USDC:GISSUER"] }],
    });
    expect(result.success).toBe(true);
  });
});

describe("WalletPatchSchema", () => {
  it("accepts a valid patch payload", () => {
    const result = WalletPatchSchema.safeParse({
      label: "Treasury",
      tags: ["ops", "hot"],
      metadata: { ownerContact: "ops@example.com" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts label at the maximum length", () => {
    const result = WalletPatchSchema.safeParse({ label: "a".repeat(64) });
    expect(result.success).toBe(true);
  });

  it("rejects label exceeding the maximum length", () => {
    const result = WalletPatchSchema.safeParse({ label: "a".repeat(65) });
    expect(result.success).toBe(false);
  });

  it("accepts the maximum number of tags", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    const result = WalletPatchSchema.safeParse({ tags });
    expect(result.success).toBe(true);
  });

  it("rejects too many tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const result = WalletPatchSchema.safeParse({ tags });
    expect(result.success).toBe(false);
  });

  it("rejects tags exceeding the maximum length", () => {
    const result = WalletPatchSchema.safeParse({ tags: ["a".repeat(33)] });
    expect(result.success).toBe(false);
  });

  it("rejects metadata exceeding the byte-size limit", () => {
    const result = WalletPatchSchema.safeParse({
      metadata: { blob: "x".repeat(4097) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty patch payload", () => {
    const result = WalletPatchSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
