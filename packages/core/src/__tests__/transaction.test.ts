import { Account, Asset, Keypair, Networks, Operation } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTransaction } from "../stellar/transaction.js";
import {
  decodeUrFrames,
  encodeUrFrames,
  type UrFrame,
} from "../stellar/airgap.js";
import { SequenceNumberCache } from "../stellar/sequence-number-cache.js";

describe("buildTransaction", () => {
  it("builds a transaction from an account with a sequence number", () => {
    const sourceAccount = new Account(Keypair.random().publicKey(), "7");
    const transaction = buildTransaction({
      sourceAccount,
      operations: [
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      ],
      networkPassphrase: Networks.TESTNET,
    });

    expect(transaction.source).toBe(sourceAccount.accountId());
    expect(transaction.operations).toHaveLength(1);
    expect(sourceAccount.sequenceNumber()).toBe("8");
  });
});

describe("SequenceNumberCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates a stale entry and refetches after tx_bad_seq", async () => {
    const cache = new SequenceNumberCache();
    const account = Keypair.random().publicKey();
    const fetchSequence = vi
      .fn<[], Promise<string>>()
      .mockResolvedValueOnce("7")
      .mockResolvedValueOnce("8");

    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(fetchSequence).toHaveBeenCalledTimes(1);

    // Simulate a tx_bad_seq failure: the cached sequence is now stale.
    cache.invalidateOnBadSeq(account);
    expect(cache.invalidateOnBadSeq(account)).toBe(false);

    expect(await cache.get(account, fetchSequence)).toBe("8");
    expect(fetchSequence).toHaveBeenCalledTimes(2);
  });

  it("expires entries after the configured ttlMs", async () => {
    vi.useFakeTimers();
    const cache = new SequenceNumberCache({ ttlMs: 1000 });
    const account = Keypair.random().publicKey();
    const fetchSequence = vi.fn<[], Promise<string>>().mockResolvedValue("7");

    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(fetchSequence).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);

    expect(cache.get(account, fetchSequence)).toBeNull();
    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(fetchSequence).toHaveBeenCalledTimes(2);
  });

  it("fires metrics hooks on hit, miss, invalidate and expire", async () => {
    vi.useFakeTimers();
    const onHit = vi.fn();
    const onMiss = vi.fn();
    const onInvalidate = vi.fn();
    const onExpire = vi.fn();
    const cache = new SequenceNumberCache({
      ttlMs: 1000,
      metrics: { onHit, onMiss, onInvalidate, onExpire },
    });
    const account = Keypair.random().publicKey();
    const fetchSequence = vi.fn<[], Promise<string>>().mockResolvedValue("7");

    // Miss then hit.
    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(onMiss).toHaveBeenCalledTimes(1);
    expect(onHit).not.toHaveBeenCalled();

    expect(await cache.get(account, fetchSequence)).toBe("7");
    expect(onHit).toHaveBeenCalledTimes(1);

    // Explicit invalidation.
    expect(cache.invalidate(account)).toBe(true);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith(account);

    // Expiry.
    expect(await cache.get(account, fetchSequence)).toBe("7");
    vi.advanceTimersByTime(1001);
    expect(cache.get(account, fetchSequence)).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(account);
  });
});

describe("air-gap UR pipeline", () => {
  // Build a ~2KB XDR envelope by padding with a large memo-like payload.
  const buildLargeXdr = (): string => {
    const sourceAccount = new Account(Keypair.random().publicKey(), "7");
    const transaction = buildTransaction({
      sourceAccount,
      operations: [
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      ],
      networkPassphrase: Networks.TESTNET,
    });
    const baseXdr = transaction.toEnvelope().toXDR("base64");
    // Pad to approximately 2KB using a deterministic filler.
    const targetLength = 2048;
    const filler = "A".repeat(Math.max(0, targetLength - baseXdr.length));
    return baseXdr + filler;
  };

  it("splits a ~2KB XDR into 5 sequential UR frames", () => {
    const xdr = buildLargeXdr();
    expect(xdr.length).toBeGreaterThanOrEqual(2000);

    const frames = encodeUrFrames(xdr);
    expect(frames).toHaveLength(5);

    // Frames must be sequential and carry index/total metadata.
    frames.forEach((frame: UrFrame, index: number) => {
      expect(frame.sequenceNum).toBe(index);
      expect(frame.total).toBe(5);
    });
  });

  it("reassembles frames received out of order and round-trips the XDR", () => {
    const xdr = buildLargeXdr();
    const frames = encodeUrFrames(xdr);

    // Simulate an animated QR scan that delivers frames out of order.
    const shuffled = [frames[2], frames[0], frames[4], frames[1], frames[3]];
    const reassembled = decodeUrFrames(shuffled);

    expect(reassembled).toBe(xdr);
  });

  it("throws a checksum error when a frame is corrupted", () => {
    const xdr = buildLargeXdr();
    const frames = encodeUrFrames(xdr);

    const corrupted: UrFrame[] = frames.map((frame, index) =>
      index === 2
        ? { ...frame, payload: frame.payload.slice(0, -1) + "X" }
        : frame,
    );

    expect(() => decodeUrFrames(corrupted)).toThrow(/checksum/i);
  });

  it("throws a completeness error when a frame is missing", () => {
    const xdr = buildLargeXdr();
    const frames = encodeUrFrames(xdr);

    const missing = frames.filter((_, index) => index !== 3);

    expect(() => decodeUrFrames(missing)).toThrow(/incomplete|missing/i);
  });
});