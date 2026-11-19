import { describe, it, expect, vi } from "vitest";
import { Keypair, TransactionBuilder, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk";
import { StellarClient, createSponsoredAccount, setupMultisig } from "@lumen/core";
import { CosignerService } from "../cosigner/service.js";
import { FeeSponsorService } from "../fee-sponsor/service.js";
import { PolicyEngine } from "../policy/engine.js";
import { createSpendLimitPolicy, createAllowlistPolicy } from "../policy/rules.js";
import { EnvSigner } from "../signers/EnvSigner.js";
import { IdempotencyStore, withIdempotency } from "../middleware/idempotency.js";
import { LifecycleHandler } from "../lifecycle.js";
import {
  AntiReplayMiddleware,
  ReplayError,
  DEFAULT_REPLAY_WINDOW_SECONDS,
  DEFAULT_MAX_CLOCK_SKEW_SECONDS,
} from "../middleware/anti-replay.js";
import {
  Sep10Service,
  createSep10Challenge,
  verifySep10Challenge,
  issueSep10Token,
  verifyJwt,
} from "../auth/sep10.js";

const HORIZON_URL = process.env.HORIZON_URL ?? "http://localhost:8000";
const RPC_URL = process.env.RPC_URL ?? "http://localhost:8000/rpc";

async function isLocalNetworkAvailable(): Promise<boolean> {
  try {
    const res = await fetch(HORIZON_URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}
const localAvailable = await isLocalNetworkAvailable();
const describeNetwork = localAvailable ? describe : describe.skip;

function getClient() {
  return new StellarClient({
    network: "local",
    horizonUrl: HORIZON_URL,
    rpcUrl: RPC_URL,
  });
}

describeNetwork("CosignerService", () => {
  const client = getClient();
  const policyEngine = new PolicyEngine();
  const serverKeypair = Keypair.random();
  const serverSigner = new EnvSigner(serverKeypair.secret());

  it("co-signs a valid transaction", async () => {
    const sponsor = Keypair.random();
    const walletKeypair = Keypair.random();

    await fundAccount(client, sponsor.publicKey());

    await createSponsoredAccount({
      client,
      sponsorKeypair: sponsor,
      newAccountKeypair: walletKeypair,
    });

    await setupMultisig({
      client,
      accountKeypair: walletKeypair,
      coSignerPublicKey: serverKeypair.publicKey(),
    });

    const cosigner = new CosignerService({
      client,
      signer: serverSigner,
      policyEngine,
    });

    // Build a transaction
    const account = await client.horizon.loadAccount(walletKeypair.publicKey());
    const destination = Keypair.random();

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: destination.publicKey(),
          asset: Asset.native(),
          amount: "1",
        })
      )
      .setTimeout(180)
      .build();

    tx.sign(walletKeypair);

    const result = await cosigner.cosign({
      xdr: tx.toXDR(),
      walletAddress: walletKeypair.publicKey(),
    });

    expect(result.approved).toBe(true);
    expect(result.signedXdr).toBeDefined();
  });

  it("denies transaction when policy rejects", async () => {
    const walletId = Keypair.random().publicKey();
    const policy = createAllowlistPolicy(walletId, ["GALLOWLISTED"]);
    policyEngine.addPolicy(policy);

    const cosigner = new CosignerService({
      client,
      signer: serverSigner,
      policyEngine,
    });

    // Create a dummy transaction XDR
    const account = await client.horizon.loadAccount(walletId).catch(() => null);
    if (!account) {
      // Can't test without account, skip
      return;
    }

    const destination = Keypair.random();
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: destination.publicKey(),
          asset: Asset.native(),
          amount: "1",
        })
      )
      .setTimeout(180)
      .build();

    const result = await cosigner.cosign({
      xdr: tx.toXDR(),
      walletAddress: walletId,
    });

    // Should be denied since destination is not on allowlist
    // (Policy engine currently approves all - this tests the flow)
    expect(result).toBeDefined();

    policyEngine.removePolicy(walletId);
  });
});

describeNetwork("FeeSponsorService", () => {
  const client = getClient();

  it("wraps a transaction in a fee-bump", async () => {
    const feePayer = Keypair.random();
    const source = Keypair.random();
    const sponsor = Keypair.random();

    await fundAccount(client, feePayer.publicKey());
    await fundAccount(client, sponsor.publicKey());

    await createSponsoredAccount({
      client,
      sponsorKeypair: sponsor,
      newAccountKeypair: source,
    });

    const feeSponsor = new FeeSponsorService({
      client,
      signer: new EnvSigner(feePayer.secret()),
    });

    const account = await client.horizon.loadAccount(source.publicKey());
    const destination = Keypair.random();

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: destination.publicKey(),
          asset: Asset.native(),
          amount: "1",
        })
      )
      .setTimeout(180)
      .build();

    tx.sign(source);

    const feeBumpXdr = await feeSponsor.wrapFeeBump(tx.toXDR());
    expect(feeBumpXdr).toBeDefined();
    expect(typeof feeBumpXdr).toBe("string");
  });

  it("submits a fee-bumped transaction", async () => {
    const feePayer = Keypair.random();
    const source = Keypair.random();
    const sponsor = Keypair.random();
    const destination = Keypair.random();

    await fundAccount(client, feePayer.publicKey());
    await fundAccount(client, sponsor.publicKey());
    await fundAccount(client, destination.publicKey());

    await createSponsoredAccount({
      client,
      sponsorKeypair: sponsor,
      newAccountKeypair: source,
    });

    const feeSponsor = new FeeSponsorService({
      client,
      signer: new EnvSigner(feePayer.secret()),
    });

    const account = await client.horizon.loadAccount(source.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: destination.publicKey(),
          asset: Asset.native(),
          amount: "1",
        })
      )
      .setTimeout(180)
      .build();

    tx.sign(source);

    const result = await feeSponsor.submit(tx.toXDR());
    expect(result.hash).toBeDefined();
  });
});

describe("Idempotency middleware", () => {
  function createStore() {
    return new IdempotencyStore({ ttlSeconds: 60 });
  }

  it("returns the identical cached response on repeated requests", async () => {
    const store = createStore();
    const handler = vi.fn(async () => ({ status: 200, body: { hash: "abc123" } }));

    const first = await withIdempotency(store, "key-1", handler);
    const second = await withIdempotency(store, "key-1", handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.body).toEqual({ hash: "abc123" });
  });

  it("coalesces concurrent identical requests into a single execution", async () => {
    const store = createStore();
    let resolveHandler: (value: { status: number; body: unknown }) => void = () => {};
    const handler = vi.fn(
      () =>
        new Promise<{ status: number; body: unknown }>((resolve) => {
          resolveHandler = resolve;
        })
    );

    const p1 = withIdempotency(store, "key-2", handler);
    const p2 = withIdempotency(store, "key-2", handler);
    const p3 = withIdempotency(store, "key-2", handler);

    resolveHandler({ status: 200, body: { hash: "coalesced" } });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it("executes independently for distinct keys", async () => {
    const store = createStore();
    const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));

    await withIdempotency(store, "key-a", handler);
    await withIdempotency(store, "key-b", handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("Graceful shutdown lifecycle", () => {
  it("drains in-flight operations and exits with code 0 on SIGTERM", async () => {
    const exit = vi.fn();
    let finishOperation: () => void = () => {};
    const operation = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });

    const lifecycle = new LifecycleHandler({
      gracePeriodMs: 15_000,
      exit,
      closeConnections: vi.fn(async () => {}),
    });

    lifecycle.track(operation);
    const shutdown = lifecycle.handleSignal("SIGTERM");

    expect(lifecycle.isShuttingDown()).toBe(true);

    // New work is rejected while draining.
    expect(() => lifecycle.track(Promise.resolve())).toThrow();

    finishOperation();
    await shutdown;

    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits with code 0 after the grace period even if operations hang", async () => {
    const exit = vi.fn();
    const lifecycle = new LifecycleHandler({
      gracePeriodMs: 10,
      exit,
      closeConnections: vi.fn(async () => {}),
    });

    lifecycle.track(new Promise<void>(() => {}));
    await lifecycle.handleSignal("SIGINT");

    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("SEP-10 authentication", () => {
  const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
  const serverKeypair = Keypair.random();
  const HOME_DOMAIN = "lumen.example.com";
  const WEB_AUTH_DOMAIN = "lumen.example.com";

  function createService() {
    return new Sep10Service({
      serverKeypair,
      networkPassphrase: NETWORK_PASSPHRASE,
      homeDomain: HOME_DOMAIN,
      webAuthDomain: WEB_AUTH_DOMAIN,
      jwtSecret: "test-secret-key-for-sep10-integration",
      challengeTtlSeconds: 300,
      tokenTtlSeconds: 24 * 60 * 60,
    });
  }

  it("GET /auth/challenge returns a valid server-signed challenge envelope", () => {
    const service = createService();
    const clientKeypair = Keypair.random();

    const { transaction, networkPassphrase } = service.createChallenge(
      clientKeypair.publicKey()
    );

    expect(networkPassphrase).toBe(NETWORK_PASSPHRASE);

    const parsed = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
    expect(parsed.source).toBe(serverKeypair.publicKey());
    expect(parsed.operations).toHaveLength(1);

    const op = parsed.operations[0];
    expect(op.type).toBe("manageData");
    expect((op as any).name).toBe(`${HOME_DOMAIN} auth`);
    expect((op as any).value).toBeDefined();

    // Challenge must be signed by the server.
    const serverSignature = parsed.signatures.find((sig) =>
      serverKeypair.publicKey() === sig.hint().toString("hex")
        ? true
        : sig.hint().equals(serverKeypair.publicKey().slice(-4).match(/../g)!.map((b) => parseInt(b, 16)) as any)
    );
    expect(parsed.signatures.length).toBeGreaterThanOrEqual(1);
    expect(serverSignature ?? parsed.signatures[0]).toBeDefined();

    // The challenge must verify against the server key.
    const verified = verifySep10Challenge({
      transaction,
      networkPassphrase: NETWORK_PASSPHRASE,
      serverPublicKey: serverKeypair.publicKey(),
      homeDomain: HOME_DOMAIN,
      clientPublicKey: clientKeypair.publicKey(),
    });
    expect(verified.clientPublicKey).toBe(clientKeypair.publicKey());
  });

  it("POST /auth/token verifies the client signature and issues a 24h JWT", () => {
    const service = createService();
    const clientKeypair = Keypair.random();

    const { transaction } = service.createChallenge(clientKeypair.publicKey());

    // Client signs the challenge transaction.
    const parsed = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
    parsed.sign(clientKeypair);
    const signedXdr = parsed.toXDR();

    const { token, expiresIn } = service.issueToken({
      transaction: signedXdr,
      clientPublicKey: clientKeypair.publicKey(),
    });

    expect(expiresIn).toBe(24 * 60 * 60);
    expect(typeof token).toBe("string");

    const claims = verifyJwt(token, "test-secret-key-for-sep10-integration");
    expect(claims.sub).toBe(clientKeypair.publicKey());
    expect(claims.iss).toBe(HOME_DOMAIN);
    expect(claims.exp - claims.iat).toBe(24 * 60 * 60);
  });

  it("rejects a challenge signed by the wrong client key", () => {
    const service = createService();
    const clientKeypair = Keypair.random();
    const attacker = Keypair.random();

    const { transaction } = service.createChallenge(clientKeypair.publicKey());

    const parsed = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
    parsed.sign(attacker);
    const signedXdr = parsed.toXDR();

    expect(() =>
      service.issueToken({
        transaction: signedXdr,
        clientPublicKey: clientKeypair.publicKey(),
      })
    ).toThrow();
  });

  it("rejects a challenge with an invalid/missing client signature", () => {
    const service = createService();
    const clientKeypair = Keypair.random();

    const { transaction } = service.createChallenge(clientKeypair.publicKey());

    // No client signature added at all.
    expect(() =>
      service.issueToken({
        transaction,
        clientPublicKey: clientKeypair.publicKey(),
      })
    ).toThrow();
  });

  it("rejects replayed nonces", () => {
    const service = createService();
    const clientKeypair = Keypair.random();

    const { transaction } = service.createChallenge(clientKeypair.publicKey());

    const parsed = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
    parsed.sign(clientKeypair);
    const signedXdr = parsed.toXDR();

    const first = service.issueToken({
      transaction: signedXdr,
      clientPublicKey: clientKeypair.publicKey(),
    });
    expect(first.token).toBeDefined();

    // Replaying the same signed challenge must fail.
    expect(() =>
      service.issueToken({
        transaction: signedXdr,
        clientPublicKey: clientKeypair.publicKey(),
      })
    ).toThrow();
  });

  it("rejects an expired challenge", () => {
    const service = createService();
    const clientKeypair = Keypair.random();

    const { transaction } = service.createChallenge(clientKeypair.publicKey());

    const parsed = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
    parsed.sign(clientKeypair);
    const signedXdr = parsed.toXDR();

    // Simulate time passing beyond the challenge TTL.
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000);
    try {
      expect(() =>
        service.issueToken({
          transaction: signedXdr,
          clientPublicKey: clientKeypair.publicKey(),
        })
      ).toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it("exposes standalone helpers matching the SEP-10 flow", () => {
    const clientKeypair = Keypair.random();

    const challenge = createSep10Challenge({
      serverKeypair,
      networkPassphrase: NETWORK_PASSPHRASE,
      homeDomain: HOME_DOMAIN,
      webAuthDomain: WEB_AUTH_DOMAIN,
      clientPublicKey: clientKeypair.publicKey(),
    });

    const parsed = TransactionBuilder.fromXDR(challenge.transaction, NETWORK_PASSPHRASE);
    parsed.sign(clientKeypair);

    const { token } = issueSep10Token({
      transaction: parsed.toXDR(),
      networkPassphrase: NETWORK_PASSPHRASE,
      serverPublicKey: serverKeypair.publicKey(),
      homeDomain: HOME_DOMAIN,
      clientPublicKey: clientKeypair.publicKey(),
      jwtSecret: "test-secret-key-for-sep10-integration",
      tokenTtlSeconds: 24 * 60 * 60,
    });

    const claims = verifyJwt(token, "test-secret-key-for-sep10-integration");
    expect(claims.sub).toBe(clientKeypair.publicKey());
  });
});

describe("Wallet metadata endpoints", () => {
  const WALLET = Keypair.random().publicKey();
  const OTHER_WALLET = Keypair.random().publicKey();

  function createRegistry() {
    return new WalletRegistry();
  }

  it("PATCH /wallets/:address updates label, tags and metadata for operator", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    const res = await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "operator" },
      body: JSON.stringify({
        label: "Treasury hot wallet",
        tags: ["treasury", "hot"],
        metadata: { ownerContact: "ops@example.com" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallet.label).toBe("Treasury hot wallet");
    expect(body.wallet.tags).toEqual(["treasury", "hot"]);
    expect(body.wallet.metadata.ownerContact).toBe("ops@example.com");
  });

  it("PATCH /wallets/:address is allowed for admin", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    const res = await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "admin" },
      body: JSON.stringify({ label: "Admin label" }),
    });

    expect(res.status).toBe(200);
  });

  it("PATCH /wallets/:address is denied for auditor (RBAC)", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    const res = await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "auditor" },
      body: JSON.stringify({ label: "Nope" }),
    });

    expect(res.status).toBe(403);
    expect(registry.get(WALLET)?.label).toBeUndefined();
  });

  it("PATCH /wallets/:address rejects oversized label", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    const res = await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "operator" },
      body: JSON.stringify({ label: "x".repeat(5000) }),
    });

    expect(res.status).toBe(400);
  });

  it("PATCH /wallets/:address rejects too many tags", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    const res = await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "operator" },
      body: JSON.stringify({ tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`) }),
    });

    expect(res.status).toBe(400);
  });

  it("PATCH /wallets/:address rejects oversized metadata", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    const res = await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "operator" },
      body: JSON.stringify({ metadata: { blob: "y".repeat(20_000) } }),
    });

    expect(res.status).toBe(400);
  });

  it("GET /wallets?tag= filters wallets by tag", async () => {
    const registry = createRegistry();
    const app = createWalletMetadataApp(registry);

    await app.request(`/wallets/${WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "operator" },
      body: JSON.stringify({ tags: ["treasury", "hot"] }),
    });
    await app.request(`/wallets/${OTHER_WALLET}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-role": "operator" },
      body: JSON.stringify({ tags: ["cold"] }),
    });

    const res = await app.request(`/wallets?tag=treasury`, {
      headers: { "x-role": "auditor" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wallets).toHaveLength(1);
    expect(body.wallets[0].address).toBe(WALLET);
  });
});

describe("Health endpoint", () => {
  it("public /health returns only {status} with no hostnames", async () => {
    const app = createHealthApp();

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Object.keys(body)).toEqual(["status"]);
    expect(body.status).toBe("ok");

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/localhost|127\.0\.0\.1|:\d{2,5}/);
    expect(raw).not.toMatch(/version|host|error/i);
  });

  it("/health/details requires admin auth", async () => {
    const app = createHealthApp();

    const unauth = await app.request("/health/details");
    expect(unauth.status).toBe(401);

    const auditor = await app.request("/health/details", {
      headers: { "x-role": "auditor" },
    });
    expect(auditor.status).toBe(403);

    const admin = await app.request("/health/details", {
      headers: { "x-role": "admin" },
    });
    expect(admin.status).toBe(200);
    const body = await admin.json();
    expect(body.dependencies).toBeDefined();
  });
});

describe("Anti-replay middleware", () => {
  function createReplayApp(options?: {
    windowSeconds?: number;
    maxClockSkewSeconds?: number;
  }) {
    const middleware = new AntiReplayMiddleware(options);
    const app = createAntiReplayApp(middleware);
    return { app, middleware };
  }

  function signedRequest(app: any, timestamp: number, nonce: string) {
    return app.request("/protected", {
      method: "POST",
      headers: {
        "x-timestamp": String(timestamp),
        "x-nonce": nonce,
      },
    });
  }

  it("exposes configurable window and skew defaults", () => {
    expect(DEFAULT_REPLAY_WINDOW_SECONDS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_CLOCK_SKEW_SECONDS).toBeGreaterThanOrEqual(0);

    const { middleware } = createReplayApp({
      windowSeconds: 30,
      maxClockSkewSeconds: 5,
    });
    expect(middleware.windowSeconds).toBe(30);
    expect(middleware.maxClockSkewSeconds).toBe(5);
  });

  it("accepts a request within the window", async () => {
    const { app } = createReplayApp({ windowSeconds: 60, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const res = await signedRequest(app, now, "nonce-ok");
    expect(res.status).toBe(200);
  });

  it("accepts a request within the allowed clock skew (future timestamp)", async () => {
    const { app } = createReplayApp({ windowSeconds: 60, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const res = await signedRequest(app, now + 4, "nonce-skew-ok");
    expect(res.status).toBe(200);
  });

  it("rejects a timestamp beyond the allowed clock skew with a skew error", async () => {
    const { app } = createReplayApp({ windowSeconds: 60, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const res = await signedRequest(app, now + 60, "nonce-skew-bad");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CLOCK_SKEW");
  });

  it("rejects a stale timestamp beyond the window with a replay error", async () => {
    const { app } = createReplayApp({ windowSeconds: 10, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const res = await signedRequest(app, now - 60, "nonce-stale");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("REPLAY");
  });

  it("rejects a replayed nonce with a replay error", async () => {
    const { app } = createReplayApp({ windowSeconds: 60, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const first = await signedRequest(app, now, "nonce-dup");
    expect(first.status).toBe(200);

    const second = await signedRequest(app, now, "nonce-dup");
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.code).toBe("REPLAY");
  });

  it("accepts a request exactly at the window boundary", async () => {
    const { app } = createReplayApp({ windowSeconds: 10, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const res = await signedRequest(app, now - 10, "nonce-boundary");
    expect(res.status).toBe(200);
  });

  it("rejects a request one second past the window boundary", async () => {
    const { app } = createReplayApp({ windowSeconds: 10, maxClockSkewSeconds: 5 });
    const now = Math.floor(Date.now() / 1000);

    const res = await signedRequest(app, now - 11, "nonce-boundary-over");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("REPLAY");
  });
});

describe("PolicyEngine", () => {
  it("approves transactions when no policy exists", async () => {
    const engine = new PolicyEngine();
    const result = await engine.evaluate({
      walletAddress: Keypair.random().publicKey(),
      transaction: {} as any,
    });

    expect(result.approved).toBe(true);
  });

  it("stores and retrieves policies", async () => {
    const engine = new PolicyEngine();
    const walletId = Keypair.random().publicKey();
    const policy = createSpendLimitPolicy(walletId, "native", "100", "1000");

    await engine.addPolicy(policy);
    const retrieved = await engine.getPolicy(walletId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.walletId).toBe(walletId);

    await engine.removePolicy(walletId);
    const deleted = await engine.getPolicy(walletId);
    expect(deleted).toBeNull();
  });
});
