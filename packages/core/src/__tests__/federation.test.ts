import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  clearFederationCache,
  isFederationAddress,
  resolveDestination,
  resolveFederation,
} from "../stellar/federation.js";

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("stellar/federation", () => {
  const accountId = Keypair.random().publicKey();
  const toml = 'FEDERATION_SERVER = "https://fed.example.com/federation"\n';

  beforeEach(() => {
    clearFederationCache();
  });

  describe("isFederationAddress", () => {
    it("accepts name*domain addresses", () => {
      expect(isFederationAddress("alice*example.com")).toBe(true);
      expect(isFederationAddress("alice@mail.com*example.com")).toBe(true);
    });

    it("rejects other strings", () => {
      expect(isFederationAddress(accountId)).toBe(false);
      expect(isFederationAddress("alice")).toBe(false);
      expect(isFederationAddress("*example.com")).toBe(false);
      expect(isFederationAddress("alice*")).toBe(false);
      expect(isFederationAddress("a*b*example.com")).toBe(false);
      expect(isFederationAddress("alice*localhost")).toBe(false);
    });
  });

  describe("resolveFederation", () => {
    it("resolves an address through stellar.toml and the federation server", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(textResponse(toml))
        .mockResolvedValueOnce(
          jsonResponse({
            stellar_address: "alice*example.com",
            account_id: accountId,
            memo_type: "id",
            memo: 42,
          }),
        );

      const record = await resolveFederation("alice*Example.com", { fetch: fetchMock });

      expect(record).toEqual({
        stellarAddress: "alice*example.com",
        accountId,
        memoType: "id",
        memo: "42",
      });
      expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/.well-known/stellar.toml");
      const query = new URL(fetchMock.mock.calls[1][0] as string);
      expect(query.origin + query.pathname).toBe("https://fed.example.com/federation");
      expect(query.searchParams.get("q")).toBe("alice*example.com");
      expect(query.searchParams.get("type")).toBe("name");
    });

    it("caches successful results until the TTL expires", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.endsWith("stellar.toml") ? textResponse(toml) : jsonResponse({ account_id: accountId }),
          ),
        );

      await resolveFederation("alice*example.com", { fetch: fetchMock });
      await resolveFederation("alice*example.com", { fetch: fetchMock });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      clearFederationCache();
      await resolveFederation("bob*example.com", { fetch: fetchMock, cacheTtlMs: 0 });
      await resolveFederation("bob*example.com", { fetch: fetchMock, cacheTtlMs: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it("rejects a malformed address without any request", async () => {
      const fetchMock = vi.fn();
      await expect(resolveFederation("alice", { fetch: fetchMock })).rejects.toThrow(
        /Invalid federation address/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails when stellar.toml cannot be loaded", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(textResponse("not found", 404));
      await expect(resolveFederation("alice*example.com", { fetch: fetchMock })).rejects.toThrow(
        /HTTP 404/,
      );
    });

    it("fails when stellar.toml has no FEDERATION_SERVER", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(textResponse('NETWORK_PASSPHRASE = "x"'));
      await expect(resolveFederation("alice*example.com", { fetch: fetchMock })).rejects.toThrow(
        /FEDERATION_SERVER/,
      );
    });

    it("refuses a non-HTTPS federation server", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(textResponse('FEDERATION_SERVER = "http://fed.example.com"'));
      await expect(resolveFederation("alice*example.com", { fetch: fetchMock })).rejects.toThrow(
        /HTTPS/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("fails when the federation server does not know the address", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(textResponse(toml))
        .mockResolvedValueOnce(jsonResponse({ detail: "not found" }, 404));
      await expect(resolveFederation("alice*example.com", { fetch: fetchMock })).rejects.toThrow(
        /could not resolve/,
      );
    });

    it("fails when the federation server returns an invalid account_id", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(textResponse(toml))
        .mockResolvedValueOnce(jsonResponse({ account_id: "GBAD" }));
      await expect(resolveFederation("alice*example.com", { fetch: fetchMock })).rejects.toThrow(
        /invalid account_id/,
      );
    });

    it("times out a request that does not answer", async () => {
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      await expect(
        resolveFederation("alice*example.com", { fetch: fetchMock as unknown as typeof fetch, timeoutMs: 10 }),
      ).rejects.toThrow(/timed out/);
    });
  });

  describe("resolveDestination", () => {
    it("returns non-federation destinations unchanged", async () => {
      const fetchMock = vi.fn();
      await expect(resolveDestination(accountId, { fetch: fetchMock })).resolves.toBe(accountId);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("resolves a federation address to its account ID", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(textResponse(toml))
        .mockResolvedValueOnce(jsonResponse({ account_id: accountId }));
      await expect(resolveDestination("alice*example.com", { fetch: fetchMock })).resolves.toBe(
        accountId,
      );
    });

    it("refuses a federation record that requires a memo", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(textResponse(toml))
        .mockResolvedValueOnce(jsonResponse({ account_id: accountId, memo_type: "id", memo: "7" }));
      await expect(resolveDestination("alice*example.com", { fetch: fetchMock })).rejects.toThrow(
        /requires a memo/,
      );
    });
  });
});
