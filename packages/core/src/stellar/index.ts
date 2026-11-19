import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Account,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from '@stellar/stellar-sdk';

import { TESTNET } from '../networks.js';

export interface SequenceNumberCacheOptions {
  /**
   * Time-to-live for cached sequence numbers in milliseconds.
   * Entries older than this are considered stale and will be refetched.
   * Defaults to 30_000 (30 seconds).
   *
   * @example
   * ```ts
   * // Cache sequence numbers for 1 minute
   * const options: SequenceNumberCacheOptions = { ttlMs: 60_000 };
   * ```
   */
  ttlMs?: number;
}

interface CachedSequence {
  sequence: string;
  updatedAt: number;
}

/**
 * Caches Stellar account sequence numbers per account and increments them
 * locally after each transaction submission to reduce Horizon API calls.
 *
 * @example
 * ```ts
 * const cache = new SequenceNumberCache({ ttlMs: 30_000 });
 * const client = new StellarClient(horizonUrl, { sequenceCache: cache });
 * ```
 */
export class SequenceNumberCache {
  private readonly ttlMs: number;
  private readonly cache: Map<string, CachedSequence> = new Map();

  /**
   * Creates a new sequence number cache.
   *
   * @param options - Cache configuration. See {@link SequenceNumberCacheOptions}.
   */
  constructor(options: SequenceNumberCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
  }

  /**
   * Returns the cached sequence number for an account if present and fresh,
   * otherwise fetches it from Horizon and stores it.
   *
   * @param accountId - The Stellar account ID (public key) to look up.
   * @param horizon - The Horizon server used to fetch the sequence when not cached.
   * @returns The account's current sequence number as a string.
   *
   * @example
   * ```ts
   * const sequence = await cache.get(accountId, horizon);
   * ```
   */
  async get(accountId: string, horizon: Horizon.Server): Promise<string> {
    const cached = this.cache.get(accountId);
    if (cached && !this.isStale(cached)) {
      return cached.sequence;
    }

    const account = await horizon.loadAccount(accountId);
    const sequence = account.sequenceNumber();
    this.cache.set(accountId, { sequence, updatedAt: Date.now() });
    return sequence;
  }

  /**
   * Increments the cached sequence number for an account locally after a
   * successful transaction submission.
   *
   * @param accountId - The Stellar account ID whose cached sequence to increment.
   *
   * @example
   * ```ts
   * cache.increment(accountId);
   * ```
   */
  increment(accountId: string): void {
    const cached = this.cache.get(accountId);
    if (!cached) {
      return;
    }

    const next = (BigInt(cached.sequence) + 1n).toString();
    this.cache.set(accountId, { sequence: next, updatedAt: Date.now() });
  }

  /**
   * Removes a cached sequence number, forcing a refetch on next access.
   *
   * @param accountId - The Stellar account ID to evict from the cache.
   *
   * @example
   * ```ts
   * cache.invalidate(accountId);
   * ```
   */
  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }

  /**
   * Clears all cached sequence numbers.
   *
   * @example
   * ```ts
   * cache.clear();
   * ```
   */
  clear(): void {
    this.cache.clear();
  }

  private isStale(entry: CachedSequence): boolean {
    return Date.now() - entry.updatedAt > this.ttlMs;
  }
}

/**
 * Options for configuring a {@link StellarClient}.
 *
 * @example
 * ```ts
 * const options: StellarClientOptions = {
 *   sequenceCache: new SequenceNumberCache({ ttlMs: 30_000 }),
 * };
 * ```
 */
export interface StellarClientOptions {
  /**
   * Optional sequence number cache. When provided, the client will use it to
   * avoid redundant Horizon `loadAccount` calls.
   *
   * @example
   * ```ts
   * const client = new StellarClient(horizonUrl, {
   *   sequenceCache: new SequenceNumberCache(),
   * });
   * ```
   */
  sequenceCache?: SequenceNumberCache;
}

/**
 * Client for interacting with a Stellar Horizon server.
 *
 * @example
 * ```ts
 * const client = new StellarClient('https://horizon-testnet.stellar.org');
 * const sequence = await client.getSequenceNumber(accountId);
 * ```
 */
export class StellarClient {
  /**
   * The underlying Horizon server instance used by this client.
   */
  public readonly horizon: Horizon.Server;
  private readonly sequenceCache?: SequenceNumberCache;

  /**
   * Creates a new Stellar client.
   *
   * @param horizonUrl - The Horizon server URL. Defaults to the Stellar testnet.
   * @param options - Client configuration. See {@link StellarClientOptions}.
   *
   * @example
   * ```ts
   * const client = new StellarClient('https://horizon.stellar.org', {
   *   sequenceCache: new SequenceNumberCache(),
   * });
   * ```
   */
  constructor(
    horizonUrl: string = TESTNET.horizonUrl,
    options: StellarClientOptions = {},
  ) {
    this.horizon = new Horizon.Server(horizonUrl);
    this.sequenceCache = options.sequenceCache;
  }

  /**
   * Loads the current sequence number for an account, using the cache when
   * configured.
   *
   * @param accountId - The Stellar account ID (public key).
   * @returns The account's current sequence number as a string.
   *
   * @example
   * ```ts
   * const sequence = await client.getSequenceNumber(accountId);
   * ```
   */
  async getSequenceNumber(accountId: string): Promise<string> {
    if (this.sequenceCache) {
      return this.sequenceCache.get(accountId, this.horizon);
    }

    const account = await this.horizon.loadAccount(accountId);
    return account.sequenceNumber();
  }

  /**
   * Builds a transaction for the given source account, using the cached
   * sequence number when available.
   *
   * @param sourceAccountId - The Stellar account ID of the transaction source.
   * @param operations - The operations to include in the transaction.
   * @param options - Optional transaction settings.
   * @param options.memo - A memo to attach to the transaction.
   * @param options.fee - The base fee per operation. Defaults to the network base fee.
   * @param options.networkPassphrase - The network passphrase. Defaults to testnet.
   * @returns A configured {@link TransactionBuilder} ready to be built and signed.
   *
   * @example
   * ```ts
   * const builder = await client.buildTransaction(
   *   sourceAccountId,
   *   [Operation.payment({ destination, asset: Asset.native(), amount: '10' })],
   *   { memo: Memo.text('hello') },
   * );
   * ```
   */
  async buildTransaction(
    sourceAccountId: string,
    operations: Operation[],
    options: { memo?: Memo; fee?: string; networkPassphrase?: string } = {},
  ): Promise<TransactionBuilder> {
    const sequence = await this.getSequenceNumber(sourceAccountId);
    const account = new Account(sourceAccountId, sequence);

    const builder = new TransactionBuilder(account, {
      fee: options.fee ?? BASE_FEE,
      memo: options.memo,
      networkPassphrase: options.networkPassphrase ?? TESTNET.networkPassphrase,
    });

    for (const operation of operations) {
      builder.addOperation(operation);
    }

    return builder;
  }

  /**
   * Submits a signed transaction and, when a cache is configured, increments
   * the cached sequence number locally.
   *
   * @param transaction - The signed transaction to submit.
   * @param sourceAccountId - The Stellar account ID of the transaction source.
   * @returns The Horizon submission response.
   *
   * @example
   * ```ts
   * const response = await client.submitTransaction(transaction, sourceAccountId);
   * ```
   */
  async submitTransaction(
    transaction: ReturnType<TransactionBuilder['build']>,
    sourceAccountId: string,
  ): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
    const response = await this.horizon.submitTransaction(transaction);
    this.sequenceCache?.increment(sourceAccountId);
    return response;
  }
}

export {
  StreamClient,
  type StreamClientOptions,
  type StreamEvent,
  type StreamEventType,
  type StreamStatus,
  type StreamStatusEvent,
  type StreamSubscription,
  type StreamTopic,
} from './stream.js';

export {
  encodeXdrToUrFrames,
  decodeUrFrames,
  type UrFrame,
  type AirgapOptions,
} from './airgap.js';

/**
 * Result of creating a sponsored Stellar account.
 *
 * @example
 * ```ts
 * const { publicKey, secretKey } = await createSponsoredAccount(client, sponsor);
 * ```
 */
export interface SponsoredAccountResult {
  /**
   * The public key of the newly created account.
   */
  publicKey: string;
  /**
   * The secret key of the newly created account. Store this securely.
   */
  secretKey: string;
}

/**
 * Creates a sponsored Stellar account using the provided sponsor keypair.
 *
 * @param client - The {@link StellarClient} used to build and submit the transaction.
 * @param sponsor - The keypair funding and sponsoring the new account.
 * @param startingBalance - The starting balance for the new account in XLM. Defaults to `'1'`.
 * @returns The new account's public and secret keys.
 *
 * @example
 * ```ts
 * const { publicKey, secretKey } = await createSponsoredAccount(
 *   client,
 *   sponsorKeypair,
 *   '2',
 * );
 * ```
 */
export async function createSponsoredAccount(
  client: StellarClient,
  sponsor: Keypair,
  startingBalance: string = '1',
): Promise<SponsoredAccountResult> {
  const newAccount = Keypair.random();

  const builder = await client.buildTransaction(sponsor.publicKey(), [
    Operation.createAccount({
      destination: newAccount.publicKey(),
      startingBalance,
    }),
  ]);

  const transaction = builder.setTimeout(180).build();
  transaction.sign(sponsor);

  await client.submitTransaction(transaction, sponsor.publicKey());

  return {
    publicKey: newAccount.publicKey(),
    secretKey: newAccount.secret(),
  };
}

/**
 * Sets up multisig on an account by adding signers and thresholds.
 *
 * @param client - The {@link StellarClient} used to build and submit the transaction.
 * @param source - The keypair of the account being configured.
 * @param signers - The signers to add, each with a public key and signing weight.
 * @param thresholds - The low, medium and high thresholds for the account.
 *
 * @example
 * ```ts
 * await setupMultisig(
 *   client,
 *   sourceKeypair,
 *   [{ publicKey: signerA, weight: 1 }, { publicKey: signerB, weight: 1 }],
 *   { low: 1, medium: 2, high: 2 },
 * );
 * ```
 */
export async function setupMultisig(
  client: StellarClient,
  source: Keypair,
  signers: { publicKey: string; weight: number }[],
  thresholds: { low: number; medium: number; high: number },
): Promise<void> {
  const operations: Operation[] = signers.map((signer) =>
    Operation.setOptions({
      signer: {
        ed25519PublicKey: signer.publicKey,
        weight: signer.weight,
      },
    }),
  );

  operations.push(
    Operation.setOptions({
      lowThreshold: thresholds.low,
      medThreshold: thresholds.medium,
      highThreshold: thresholds.high,
    }),
  );

  const builder = await client.buildTransaction(source.publicKey(), operations);
  const transaction = builder.setTimeout(180).build();
  transaction.sign(source);

  await client.submitTransaction(transaction, source.publicKey());
}

/**
 * Options for sending a payment via {@link send}.
 *
 * @example
 * ```ts
 * const options: WalletSendOptions = { memo: Memo.text('thanks') };
 * ```
 */
export interface WalletSendOptions {
  /**
   * An optional memo to attach to the payment transaction.
   *
   * @example
   * ```ts
   * const options: WalletSendOptions = { memo: Memo.text('invoice-42') };
   * ```
   */
  memo?: Memo;
  /**
   * The asset to send. Defaults to the native asset (XLM).
   *
   * @example
   * ```ts
   * const options: WalletSendOptions = {
   *   asset: new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
   * };
   * ```
   */
  asset?: Asset;
}

/**
 * Sends a payment from a wallet using the provided StellarClient.
 *
 * @param client - The {@link StellarClient} used to build and submit the transaction.
 * @param source - The keypair of the sending account.
 * @param destination - The destination Stellar account ID.
 * @param amount - The amount to send, as a string.
 * @param options - Optional memo and asset settings. See {@link WalletSendOptions}.
 * @returns The Horizon submission response.
 *
 * @example
 * ```ts
 * const response = await send(client, sourceKeypair, destination, '10');
 * ```
 */
export async function send(
  client: StellarClient,
  source: Keypair,
  destination: string,
  amount: string,
  options: WalletSendOptions = {},
): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
  const builder = await client.buildTransaction(
    source.publicKey(),
    [
      Operation.payment({
        destination,
        asset: options.asset ?? Asset.native(),
        amount,
      }),
    ],
    { memo: options.memo },
  );

  const transaction = builder.setTimeout(180).build();
  transaction.sign(source);

  return client.submitTransaction(transaction, source.publicKey());
}
