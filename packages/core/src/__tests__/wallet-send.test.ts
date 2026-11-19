import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Asset,
  Keypair,
  Memo,
  TransactionBuilder,
  Account,
  Networks,
} from "@stellar/stellar-sdk";
import type { StellarClient } from "../stellar/client.js";
import { Wallet } from "../wallet/wallet.js";
import { StellarResultError } from "../stellar/result-codes.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createWallet(serverUrl?: string, destinationData: Record<string, string> = {}) {
  const ownerKeypair = Keypair.random();
  const submitTransaction = vi.fn();
  const loadAccount = vi.fn().mockResolvedValue({ data_attr: destinationData });
  const wallet = new Wallet({
    client: {
      horizon: { submitTransaction, loadAccount },
    } as unknown as StellarClient,
    sponsorKeypair: Keypair.random(),
    serverPublicKey: Keypair.random().publicKey(),
    serverUrl,
    ownerKeypair,
  });
  Object.defineProperty(wallet, "_address", { value: ownerKeypair.publicKey() });
  vi.spyOn(wallet, "buildPaymentTransaction").mockResolvedValue("owner-signed-xdr");
  return { wallet, submitTransaction, loadAccount, ownerKeypair };
}

function mockSuccessfulFetch() {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ signedXdr: "cosigned-xdr" }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ hash: "fee-bump-hash" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Wallet.send", () => {
  it("routes signed payments through co-signing and sponsored submission", async () => {
    const { wallet, submitTransaction, ownerKeypair } = createWallet("https://lumen.example/");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedXdr: "cosigned-xdr" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ hash: "fee-bump-hash" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(wallet.send(Keypair.random().publicKey(), Asset.native(), "1")).resolves.toEqual({
      hash: "fee-bump-hash",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://lumen.example/cosign");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      xdr: "owner-signed-xdr",
      walletAddress: ownerKeypair.publicKey(),
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://lumen.example/fee-bump/submit");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      xdr: "cosigned-xdr",
    });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("does not send payments directly when no Lumen server URL is configured", async () => {
    const { wallet, submitTransaction } = createWallet();

    await expect(wallet.send(Keypair.random().publicKey(), Asset.native(), "1")).rejects.toThrow(
      "A Lumen server URL is required",
    );
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("throws a StellarResultError when fee-bump submission returns a result code", async () => {
    const { wallet } = createWallet("https://lumen.example/");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedXdr: "cosigned-xdr" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "The source account does not have enough funds.",
            code: "op_underfunded",
            operationIndex: 0,
            hint: "Fund the account or reduce the amount.",
          }),
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const error = await wallet
      .send(Keypair.random().publicKey(), Asset.native(), "1")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StellarResultError);
    expect(error).toMatchObject({
      code: "op_underfunded",
      operationIndex: 0,
      message: "The source account does not have enough funds.",
    });
  });

  it("forwards the memo to buildPaymentTransaction", async () => {
    const { wallet } = createWallet("https://lumen.example/");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedXdr: "cosigned-xdr" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ hash: "fee-bump-hash" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const destination = Keypair.random().publicKey();
    const memo = Memo.text("hello");

    await wallet.send(destination, Asset.native(), "1", memo);

    expect(wallet.buildPaymentTransaction).toHaveBeenCalledWith(
      destination,
      Asset.native(),
      "1",
      memo,
    );
  });
});

describe("Wallet.send SEP-0029 memo-required check", () => {
  const memoRequired = { "config.memo_required": "MQ==" };

  it("blocks sends without a memo when the destination requires one", async () => {
    const { wallet, loadAccount } = createWallet("https://lumen.example/", memoRequired);
    const fetchMock = mockSuccessfulFetch();
    const destination = Keypair.random().publicKey();

    await expect(wallet.send(destination, Asset.native(), "1")).rejects.toThrow(
      "requires a memo (SEP-0029)",
    );
    expect(loadAccount).toHaveBeenCalledWith(destination);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows sends with a memo when the destination requires one", async () => {
    const { wallet, loadAccount } = createWallet("https://lumen.example/", memoRequired);
    mockSuccessfulFetch();

    await expect(
      wallet.send(Keypair.random().publicKey(), Asset.native(), "1", Memo.id("42")),
    ).resolves.toEqual({ hash: "fee-bump-hash" });
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it("treats Memo.none as a missing memo", async () => {
    const { wallet } = createWallet("https://lumen.example/", memoRequired);
    mockSuccessfulFetch();

    await expect(
      wallet.send(Keypair.random().publicKey(), Asset.native(), "1", Memo.none()),
    ).rejects.toThrow("requires a memo (SEP-0029)");
  });

  it("allows the check to be overridden explicitly", async () => {
    const { wallet, loadAccount } = createWallet("https://lumen.example/", memoRequired);
    mockSuccessfulFetch();

    await expect(
      wallet.send(Keypair.random().publicKey(), Asset.native(), "1", undefined, {
        skipMemoRequiredCheck: true,
      }),
    ).resolves.toEqual({ hash: "fee-bump-hash" });
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it("does not require a memo for destinations that do not exist yet", async () => {
    const { wallet, loadAccount } = createWallet("https://lumen.example/");
    loadAccount.mockRejectedValueOnce({ response: { status: 404 } });
    mockSuccessfulFetch();

    await expect(wallet.send(Keypair.random().publicKey(), Asset.native(), "1")).resolves.toEqual({
      hash: "fee-bump-hash",
    });
  });
});

describe("Wallet.buildPaymentTransaction memo handling", () => {
  function createBuildWallet() {
    const ownerKeypair = Keypair.random();
    const loadAccount = vi.fn().mockResolvedValue(new Account(ownerKeypair.publicKey(), "1"));
    const wallet = new Wallet({
      client: {
        horizon: { loadAccount },
      } as unknown as StellarClient,
      sponsorKeypair: Keypair.random(),
      serverPublicKey: Keypair.random().publicKey(),
      ownerKeypair,
    });
    Object.defineProperty(wallet, "_address", { value: ownerKeypair.publicKey() });
    return { wallet, ownerKeypair };
  }

  function decodeMemo(xdr: string) {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    return (tx as { memo: Memo }).memo;
  }

  it("builds a transaction with a text memo from a string", async () => {
    const { wallet } = createBuildWallet();

    const xdr = await wallet.buildPaymentTransaction(
      Keypair.random().publicKey(),
      Asset.native(),
      "1",
      "hello",
    );

    const memo = decodeMemo(xdr);
    expect(memo.type).toBe(Memo.text("").type);
    expect(memo.value.toString()).toBe("hello");
  });

  it("builds a transaction with a Memo.text memo", async () => {
    const { wallet } = createBuildWallet();

    const xdr = await wallet.buildPaymentTransaction(
      Keypair.random().publicKey(),
      Asset.native(),
      "1",
      Memo.text("text-memo"),
    );

    const memo = decodeMemo(xdr);
    expect(memo.type).toBe(Memo.text("").type);
    expect(memo.value.toString()).toBe("text-memo");
  });

  it("builds a transaction with a Memo.id memo", async () => {
    const { wallet } = createBuildWallet();

    const xdr = await wallet.buildPaymentTransaction(
      Keypair.random().publicKey(),
      Asset.native(),
      "1",
      Memo.id("12345"),
    );

    const memo = decodeMemo(xdr);
    expect(memo.type).toBe(Memo.id("").type);
    expect(memo.value.toString()).toBe("12345");
  });

  it("builds a transaction with a Memo.hash memo", async () => {
    const { wallet } = createBuildWallet();
    const hash = Buffer.alloc(32, 7);

    const xdr = await wallet.buildPaymentTransaction(
      Keypair.random().publicKey(),
      Asset.native(),
      "1",
      Memo.hash(hash),
    );

    const memo = decodeMemo(xdr);
    expect(memo.type).toBe(Memo.hash(Buffer.alloc(32)).type);
    expect(Buffer.from(memo.value as Buffer)).toEqual(hash);
  });
});
