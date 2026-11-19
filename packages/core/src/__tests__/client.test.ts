import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Networks } from "@stellar/stellar-sdk";
import { StellarClient } from "../stellar/client.js";
import {
  TESTNET,
  PUBLIC,
  FUTURENET,
  LOCAL,
  resolveNetwork,
} from "../networks.js";

const REPO_ROOT = resolve(__dirname, "../../../..");
const NETWORKS_MODULE = resolve(__dirname, "../networks.ts");

const PASSPHRASE_LITERALS = [
  "Test SDF Network ; September 2015",
  "Public Global Stellar Network ; September 2015",
  "Test SDF Future Network ; October 2022",
  "Standalone Network ; February 2017",
];

const ENDPOINT_LITERALS = [
  "https://horizon-testnet.stellar.org",
  "https://horizon.stellar.org",
  "https://horizon-futurenet.stellar.org",
  "https://rpc-futurenet.stellar.org",
  "https://soroban-testnet.stellar.org",
];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("core/client configuration", () => {
  it("defaults to testnet configuration", () => {
    const client = new StellarClient();
    expect(client.config.network).toBe("testnet");
    expect(client.config.horizonUrl).toContain("testnet");
  });

  it("configures mainnet network correctly", () => {
    const client = new StellarClient({ network: "mainnet" });
    expect(client.config.network).toBe("mainnet");
    expect(client.config.horizonUrl).toBe("https://horizon.stellar.org");
  });

  it("configures futurenet network correctly", () => {
    const client = new StellarClient({ network: "futurenet" });
    expect(client.config.network).toBe("futurenet");
    expect(client.config.horizonUrl).toBe(
      "https://horizon-futurenet.stellar.org",
    );
    expect(client.config.rpcUrl).toBe("https://rpc-futurenet.stellar.org");
    expect(client.config.networkPassphrase).toBe(Networks.FUTURENET);
  });

  it("does not duplicate network passphrase or endpoint literals outside networks.ts", () => {
    const files = collectSourceFiles(REPO_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      if (resolve(file) === NETWORKS_MODULE) continue;
      const content = readFileSync(file, "utf8");
      const rel = relative(REPO_ROOT, file);
      for (const literal of [...PASSPHRASE_LITERALS, ...ENDPOINT_LITERALS]) {
        if (content.includes(literal)) {
          offenders.push(`${rel}: ${literal}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("exposes typed network constants", () => {
    expect(TESTNET.networkPassphrase).toBe(Networks.TESTNET);
    expect(PUBLIC.networkPassphrase).toBe(Networks.PUBLIC);
    expect(FUTURENET.networkPassphrase).toBe(Networks.FUTURENET);
    expect(LOCAL.networkPassphrase).toBe(Networks.STANDALONE);
    expect(TESTNET.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(PUBLIC.horizonUrl).toBe("https://horizon.stellar.org");
  });

  it("resolves networks by name", () => {
    expect(resolveNetwork("testnet")).toBe(TESTNET);
    expect(resolveNetwork("mainnet")).toBe(PUBLIC);
    expect(resolveNetwork("public")).toBe(PUBLIC);
    expect(resolveNetwork("futurenet")).toBe(FUTURENET);
    expect(resolveNetwork("local")).toBe(LOCAL);
  });

  it("resolves networks by passphrase", () => {
    expect(resolveNetwork(Networks.TESTNET)).toBe(TESTNET);
    expect(resolveNetwork(Networks.PUBLIC)).toBe(PUBLIC);
    expect(resolveNetwork(Networks.FUTURENET)).toBe(FUTURENET);
    expect(resolveNetwork(Networks.STANDALONE)).toBe(LOCAL);
  });

  it("exposes a batch cosign helper that processes each request", async () => {
    const client = new StellarClient();
    const requests = [
      { xdr: "AAAA", walletAddress: "GAAA" },
      { xdr: "BBBB", walletAddress: "GBBB" },
    ];

    const results = await client.cosignBatch(requests, async (req) => ({
      signedXdr: `${req.xdr}-signed`,
      approved: true,
      reason: "ok",
    }));

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      signedXdr: "AAAA-signed",
      approved: true,
      reason: "ok",
    });
    expect(results[1]).toEqual({
      signedXdr: "BBBB-signed",
      approved: true,
      reason: "ok",
    });
  });

  it("returns a per-request rejection result when a batch item fails", async () => {
    const client = new StellarClient();
    const requests = [
      { xdr: "AAAA", walletAddress: "GAAA" },
      { xdr: "BBBB", walletAddress: "GBBB" },
    ];

    const results = await client.cosignBatch(requests, async (req) => {
      if (req.xdr === "BBBB") {
        throw new Error("policy rejected");
      }
      return { signedXdr: `${req.xdr}-signed`, approved: true, reason: "ok" };
    });

    expect(results).toHaveLength(2);
    expect(results[0].approved).toBe(true);
    expect(results[1]).toEqual({
      signedXdr: "",
      approved: false,
      reason: "policy rejected",
    });
  });
});
