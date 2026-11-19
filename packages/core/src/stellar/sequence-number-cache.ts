/**
 * Caches Stellar account sequence numbers per account so that high-throughput
 * flows can avoid a Horizon `loadAccount()` round-trip for every transaction.
 *
 * The cache stores the last known sequence number and increments it locally
 * after each transaction submission. Entries expire after `ttlMs` so that
 * stale values are eventually refreshed from Horizon.
 */
/**
 * Optional metrics hooks, invoked as the cache is used. All hooks are
 * best-effort: exceptions thrown by a hook are swallowed so that metrics can
 * never break transaction submission.
 */
export interface SequenceNumberCacheMetrics {
  /** Called when a live cached sequence number is returned. */
  onHit?: (accountId: string, sequence: string) => void;
  /** Called when no live entry exists for an account. */
  onMiss?: (accountId: string) => void;
  /** Called when an entry is explicitly invalidated. */
  onInvalidate?: (accountId: string) => void;
  /** Called when an entry is dropped because its TTL elapsed. */
  onExpire?: (accountId: string) => void;
}

export interface SequenceNumberCacheOpts {
  /** Time-to-live for a cached entry, in milliseconds. Defaults to 30_000. */
  ttlMs?: number;
  /** Optional metrics hooks. */
  metrics?: SequenceNumberCacheMetrics;
}

interface CacheEntry {
  sequence: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;

export class SequenceNumberCache {
  private readonly ttlMs: number;
  private readonly metrics: SequenceNumberCacheMetrics;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(opts: SequenceNumberCacheOpts = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.metrics = opts.metrics ?? {};
  }

  /**
   * Returns the cached sequence number for an account, or `null` when there is
   * no entry or the entry has expired.
   */
  get(accountId: string): string | null {
    const entry = this.entries.get(accountId);
    if (!entry) {
      this.emit(this.metrics.onMiss, accountId);
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(accountId);
      this.emit(this.metrics.onExpire, accountId);
      this.emit(this.metrics.onMiss, accountId);
      return null;
    }
    this.emit(this.metrics.onHit, accountId, entry.sequence);
    return entry.sequence;
  }

  /**
   * Stores the sequence number for an account, refreshing the TTL.
   */
  set(accountId: string, sequence: string): void {
    this.entries.set(accountId, {
      sequence,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Increments the cached sequence number for an account by one, as happens
   * after a transaction is submitted. Returns the new sequence number, or
   * `null` when there is no live entry to increment.
   */
  increment(accountId: string): string | null {
    const current = this.get(accountId);
    if (current === null) return null;
    const next = (BigInt(current) + 1n).toString();
    this.set(accountId, next);
    return next;
  }

  /**
   * Removes the cached entry for an account. This is the recovery path after a
   * submission fails with `tx_bad_seq`: dropping the stale entry forces the
   * next submission to reload the sequence number from Horizon.
   */
  invalidate(accountId: string): void {
    if (this.entries.delete(accountId)) {
      this.emit(this.metrics.onInvalidate, accountId);
    }
  }

  /**
   * Invalidates the cached entry for an account when a submission result code
   * indicates a stale sequence number (`tx_bad_seq`). Returns `true` when the
   * entry was invalidated.
   */
  invalidateOnBadSeq(accountId: string, resultCode: string): boolean {
    if (resultCode !== 'tx_bad_seq') return false;
    this.invalidate(accountId);
    return true;
  }

  /** Clears all cached entries. */
  clear(): void {
    this.entries.clear();
  }

  private emit<T extends unknown[]>(
    hook: ((...args: T) => void) | undefined,
    ...args: T
  ): void {
    if (!hook) return;
    try {
      hook(...args);
    } catch {
      // Metrics must never break transaction submission.
    }
  }
}
