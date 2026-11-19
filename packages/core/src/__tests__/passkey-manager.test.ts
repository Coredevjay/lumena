import { describe, it, expect, vi, afterEach } from "vitest";
import { PasskeyManager } from "../keys/passkey.js";
import { Keypair } from "@stellar/stellar-sdk";

describe("PasskeyManager", () => {
  describe("deriveKeypairFallback", () => {
    it("same inputs always produce the same keypair (determinism)", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id-123");
      const username = "testuser";

      const keypair1 = await manager.deriveKeypairFallback(credentialId, username);
      const keypair2 = await manager.deriveKeypairFallback(credentialId, username);

      expect(keypair1.publicKey()).toBe(keypair2.publicKey());
      expect(keypair1.secret()).toBe(keypair2.secret());
    });

    it("different usernames produce different keypairs", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id-123");

      const keypair1 = await manager.deriveKeypairFallback(credentialId, "user1");
      const keypair2 = await manager.deriveKeypairFallback(credentialId, "user2");

      expect(keypair1.publicKey()).not.toBe(keypair2.publicKey());
      expect(keypair1.secret()).not.toBe(keypair2.secret());
    });

    it("different credential IDs produce different keypairs", async () => {
      const manager = new PasskeyManager();
      const username = "testuser";

      const keypair1 = await manager.deriveKeypairFallback(
        new TextEncoder().encode("cred-1"),
        username,
      );
      const keypair2 = await manager.deriveKeypairFallback(
        new TextEncoder().encode("cred-2"),
        username,
      );

      expect(keypair1.publicKey()).not.toBe(keypair2.publicKey());
      expect(keypair1.secret()).not.toBe(keypair2.secret());
    });

    it("returns a valid Stellar keypair", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id-123");
      const username = "testuser";

      const keypair = await manager.deriveKeypairFallback(credentialId, username);

      expect(keypair).toBeInstanceOf(Keypair);
      expect(typeof keypair.publicKey()).toBe("string");
      expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
      expect(typeof keypair.secret()).toBe("string");
      expect(keypair.secret()).toMatch(/^S[A-Z0-9]{55}$/);
    });
  });

  describe("deriveKeypairFromWebAuthn", () => {
    it("uses PRF path when PRF output is available", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id");
      const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const username = "testuser";

      const keypair = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        prfOutput,
        username,
      });

      expect(keypair).toBeInstanceOf(Keypair);
      expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
    });

    it("uses fallback path when PRF output is unavailable", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id");
      const username = "testuser";

      const keypair = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        username,
      });

      expect(keypair).toBeInstanceOf(Keypair);
      expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
    });

    it("PRF path produces deterministic results", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id");
      const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const username = "testuser";

      const keypair1 = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        prfOutput,
        username,
      });

      const keypair2 = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        prfOutput,
        username,
      });

      expect(keypair1.publicKey()).toBe(keypair2.publicKey());
    });

    it("fallback path produces deterministic results", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id");
      const username = "testuser";

      const keypair1 = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        username,
      });

      const keypair2 = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        username,
      });

      expect(keypair1.publicKey()).toBe(keypair2.publicKey());
    });

    it("PRF path and fallback path produce different keypairs", async () => {
      const manager = new PasskeyManager();
      const credentialId = new TextEncoder().encode("test-credential-id");
      const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const username = "testuser";

      const keypairPRF = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        prfOutput,
        username,
      });

      const keypairFallback = await manager.deriveKeypairFromWebAuthn({
        credentialId,
        username,
      });

      expect(keypairPRF.publicKey()).not.toBe(keypairFallback.publicKey());
    });
  });

  describe("multi-passkey flows (virtual authenticator)", () => {
    const RP_ID = "example.test";
    const ORIGIN = "https://example.test";

    const b64url = (bytes: Uint8Array): string =>
      Buffer.from(bytes)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const makeCredential = (id: string) => ({
      id,
      rawId: new TextEncoder().encode(id).buffer,
      type: "public-key",
      response: {
        clientDataJSON: new TextEncoder().encode(
          JSON.stringify({ type: "webauthn.create", challenge: "Y2hhbGxlbmdl", origin: ORIGIN }),
        ).buffer,
        attestationObject: new Uint8Array([0xa0]).buffer,
      },
      getClientExtensionResults: () => ({}),
    });

    const installVirtualAuthenticator = (ids: string[]) => {
      let call = 0;
      const create = vi.fn(async () => makeCredential(ids[call++]));
      const get = vi.fn(async () => makeCredential(ids[0]));
      vi.stubGlobal("navigator", { credentials: { create, get } });
      return { create, get };
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("addPasskey appends a second credential", async () => {
      installVirtualAuthenticator(["cred-a", "cred-b"]);
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });

      const first = await manager.addPasskey({ username: "alice" });
      const second = await manager.addPasskey({ username: "alice" });

      expect(first.credentialId).not.toBe(second.credentialId);
      const credentials = await manager.listPasskeys();
      expect(credentials).toHaveLength(2);
      expect(credentials.map((c) => c.credentialId)).toEqual([
        first.credentialId,
        second.credentialId,
      ]);
    });

    it("removePasskey removes a non-last credential", async () => {
      installVirtualAuthenticator(["cred-a", "cred-b"]);
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });

      const first = await manager.addPasskey({ username: "alice" });
      const second = await manager.addPasskey({ username: "alice" });

      await manager.removePasskey(second.credentialId, { credentialId: first.credentialId });

      const credentials = await manager.listPasskeys();
      expect(credentials).toHaveLength(1);
      expect(credentials[0].credentialId).toBe(first.credentialId);
    });

    it("removePasskey throws when attempting to remove the last credential", async () => {
      installVirtualAuthenticator(["cred-a"]);
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });

      const only = await manager.addPasskey({ username: "alice" });

      await expect(
        manager.removePasskey(only.credentialId, { credentialId: only.credentialId }),
      ).rejects.toThrow(/last credential/i);

      const credentials = await manager.listPasskeys();
      expect(credentials).toHaveLength(1);
    });

    it("removePasskey requires another valid credential", async () => {
      installVirtualAuthenticator(["cred-a", "cred-b"]);
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });

      const first = await manager.addPasskey({ username: "alice" });
      const second = await manager.addPasskey({ username: "alice" });

      await expect(
        manager.removePasskey(second.credentialId, { credentialId: "unknown-cred" }),
      ).rejects.toThrow(/valid credential/i);

      expect(await manager.listPasskeys()).toHaveLength(2);
      expect(first.credentialId).toBeDefined();
    });
  });

  describe("verifyRegistrationResponse", () => {
    const RP_ID = "example.test";
    const ORIGIN = "https://example.test";

    const b64url = (bytes: Uint8Array): string =>
      Buffer.from(bytes)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const sha256 = async (data: Uint8Array): Promise<Uint8Array> =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", data));

    const buildClientData = (overrides: Record<string, unknown> = {}) =>
      new TextEncoder().encode(
        JSON.stringify({
          type: "webauthn.create",
          challenge: "Y2hhbGxlbmdl",
          origin: ORIGIN,
          ...overrides,
        }),
      );

    // Minimal CBOR encoder for the subset of maps/strings/bytes/integers used in
    // attestation objects.
    const cborEncode = (value: unknown): Uint8Array => {
      const chunks: number[] = [];
      const push = (...bytes: number[]) => chunks.push(...bytes);
      const encodeLength = (major: number, len: number) => {
        if (len < 24) push((major << 5) | len);
        else if (len < 0x100) push((major << 5) | 24, len);
        else push((major << 5) | 25, (len >> 8) & 0xff, len & 0xff);
      };
      const encode = (v: unknown) => {
        if (typeof v === "number") {
          if (v >= 0) encodeLength(0, v);
          else encodeLength(1, -1 - v);
        } else if (typeof v === "string") {
          const bytes = new TextEncoder().encode(v);
          encodeLength(3, bytes.length);
          push(...bytes);
        } else if (v instanceof Uint8Array) {
          encodeLength(2, v.length);
          push(...v);
        } else if (v instanceof Map) {
          encodeLength(5, v.size);
          for (const [k, val] of v) {
            encode(k);
            encode(val);
          }
        } else {
          throw new Error(`unsupported CBOR value: ${String(v)}`);
        }
      };
      encode(value);
      return new Uint8Array(chunks);
    };

    const buildAuthData = async (opts: {
      rpId?: string;
      flags?: number;
      credentialId?: Uint8Array;
    } = {}) => {
      const rpId = opts.rpId ?? RP_ID;
      const flags = opts.flags ?? 0x41; // UP | AT
      const credentialId = opts.credentialId ?? new TextEncoder().encode("cred-a");
      const rpIdHash = await sha256(new TextEncoder().encode(rpId));
      const aaguid = new Uint8Array(16);
      const credIdLen = new Uint8Array([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff]);
      const coseKey = cborEncode(
        new Map<number, unknown>([
          [1, 2], // kty: EC2
          [3, -7], // alg: ES256
          [-1, 1], // crv: P-256
          [-2, new Uint8Array(32).fill(1)], // x
          [-3, new Uint8Array(32).fill(2)], // y
        ]),
      );
      const parts = [rpIdHash, new Uint8Array([flags]), new Uint8Array([0, 0, 0, 0]), aaguid, credIdLen, credentialId, coseKey];
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
      }
      return out;
    };

    const buildAttestationObject = async (opts: {
      fmt?: string;
      rpId?: string;
      flags?: number;
      clientData?: Uint8Array;
      credentialId?: Uint8Array;
    } = {}) => {
      const authData = await buildAuthData(opts);
      const attStmt = opts.fmt === "packed" ? new Map<string, unknown>([["alg", -7], ["sig", new Uint8Array(64)]]) : new Map<string, unknown>();
      return cborEncode(
        new Map<string, unknown>([
          ["fmt", opts.fmt ?? "none"],
          ["attStmt", attStmt],
          ["authData", authData],
        ]),
      );
    };

    const buildResponse = async (opts: {
      fmt?: string;
      rpId?: string;
      flags?: number;
      clientData?: Uint8Array;
      credentialId?: Uint8Array;
    } = {}) => {
      const clientDataJSON = opts.clientData ?? buildClientData();
      const attestationObject = await buildAttestationObject(opts);
      return {
        id: b64url(opts.credentialId ?? new TextEncoder().encode("cred-a")),
        rawId: (opts.credentialId ?? new TextEncoder().encode("cred-a")).buffer,
        type: "public-key",
        response: {
          clientDataJSON: clientDataJSON.buffer,
          attestationObject: attestationObject.buffer,
        },
        getClientExtensionResults: () => ({}),
      };
    };

    const verify = (manager: PasskeyManager, response: unknown, opts: Record<string, unknown> = {}) =>
      manager.verifyRegistrationResponse(response as PublicKeyCredential, {
        expectedChallenge: "Y2hhbGxlbmdl",
        expectedOrigin: ORIGIN,
        expectedRpId: RP_ID,
        ...opts,
      });

    it("accepts a spec-style 'none' attestation vector", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      const response = await buildResponse({ fmt: "none" });

      const result = await verify(manager, response);

      expect(result.verified).toBe(true);
      expect(result.attestationFormat).toBe("none");
      expect(result.credentialId).toBe(b64url(new TextEncoder().encode("cred-a")));
    });

    it("accepts a spec-style 'packed' attestation vector", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      const response = await buildResponse({ fmt: "packed" });

      const result = await verify(manager, response);

      expect(result.verified).toBe(true);
      expect(result.attestationFormat).toBe("packed");
    });

    it("rejects a wrong origin", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      const response = await buildResponse({
        clientData: buildClientData({ origin: "https://evil.test" }),
      });

      await expect(verify(manager, response)).rejects.toThrow(/origin/i);
    });

    it("rejects a wrong RP ID hash", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      const response = await buildResponse({ rpId: "other.test" });

      await expect(verify(manager, response)).rejects.toThrow(/rp id/i);
    });

    it("rejects missing user verification when requireUserVerification is true", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      // UP set, UV not set.
      const response = await buildResponse({ flags: 0x41 });

      await expect(
        verify(manager, response, { requireUserVerification: true }),
      ).rejects.toThrow(/user verification/i);
    });

    it("accepts user verification when requireUserVerification is true", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      // UP | UV | AT
      const response = await buildResponse({ flags: 0x45 });

      const result = await verify(manager, response, { requireUserVerification: true });

      expect(result.verified).toBe(true);
      expect(result.userVerified).toBe(true);
    });

    it("rejects an unsupported attestation format", async () => {
      const manager = new PasskeyManager({ rpId: RP_ID, origin: ORIGIN });
      const response = await buildResponse({ fmt: "tpm" });

      await expect(verify(manager, response)).rejects.toThrow(/attestation/i);
    });
  });
});
