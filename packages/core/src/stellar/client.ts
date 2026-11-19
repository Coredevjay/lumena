import { Horizon, rpc as sorobanRpc } from "@stellar/stellar-sdk";
import type { StellarConfig, StellarNetwork } from "@lumen/types";
import { FUTURENET, LOCAL, PUBLIC, TESTNET, resolveNetwork } from "../networks.js";
import { SequenceNumberCache } from "./sequence-number-cache";
import { crypto } from "../crypto";

type HorizonServer = InstanceType<typeof Horizon.Server>;
type RpcServer = InstanceType<typeof sorobanRpc.Server>;

const NETWORKS: Record<StellarNetwork, StellarConfig> = {
  testnet: TESTNET,
  mainnet: PUBLIC,
  local: LOCAL,
  futurenet: FUTURENET,
};

/**
 * Options accepted by the {@link StellarClient} constructor.
 *
 * All options are optional; sensible defaults are derived from the selected
 * {@link StellarClientOpts.network}.
 *
 * @example
 * ```ts
 * const client = new StellarClient({ network: "testnet" });
 * ```
 */
export interface StellarClientOpts {
  /**
   * The Stellar network to connect to. Determines the default Horizon and
   * Soroban RPC endpoints as well as the network passphrase.
   *
   * @defaultValue `"testnet"`
   * @example
   * ```ts
   * new StellarClient({ network: "mainnet" });
   * new StellarClient({ network: "futurenet" });
   * ```
   */
  network?: StellarNetwork;

  /**
   * Overrides the Horizon endpoint for the selected network. Useful for
   * self-hosted or proxied Horizon instances.
   *
   * @example
   * ```ts
   * new StellarClient({ horizonUrl: "https://horizon.example.com" });
   * ```
   */
  horizonUrl?: string;

  /**
   * Overrides the Soroban RPC endpoint for the selected network.
   *
   * @example
   * ```ts
   * new StellarClient({ rpcUrl: "https://rpc.example.com" });
   * ```
   */
  rpcUrl?: string;

  /**
   * Opt-in sequence number cache. Pass `true` for defaults or options to tune
   * the TTL.
   *
   * @example
   * ```ts
   * new StellarClient({ sequenceCache: true });
   * new StellarClient({ sequenceCache: { ttlMs: 30_000 } });
   * ```
   */
  sequenceCache?: boolean | { ttlMs?: number };

  /**
   * Per-request timeout in milliseconds applied to Horizon and Soroban RPC
   * calls.
   *
   * @defaultValue `30000`
   * @example
   * ```ts
   * new StellarClient({ timeoutMs: 10_000 });
   * ```
   */
  timeoutMs?: number;

  /**
   * Account ID of the fee sponsor used when building sponsored transactions.
   *
   * @example
   * ```ts
   * new StellarClient({ sponsor: "GSPONSOR..." });
   * ```
   */
  sponsor?: string;

  /**
   * Signer used to sign transactions built by this client. May be a secret
   * key, a keypair, or a custom signing callback.
   *
   * @example
   * ```ts
   * new StellarClient({ signer: Keypair.fromSecret(secret) });
   * ```
   */
  signer?: StellarSigner;
}

/**
 * A signer capable of producing a signature for a transaction payload.
 */
export interface StellarSigner {
  /** Returns the public key (account ID) associated with this signer. */
  publicKey(): string;
  /** Signs the given payload and returns the raw signature bytes. */
  sign(payload: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

/**
 * Client for interacting with a Stellar network over Horizon and Soroban RPC.
 *
 * @example
 * ```ts
 * const client = new StellarClient({ network: "testnet" });
 * const seq = await client.loadSequenceNumber(accountId);
 * ```
 */
export class StellarClient {
  /** Resolved configuration for this client, including network passphrase. */
  readonly config: StellarConfig;
  /** Underlying Horizon server instance. */
  readonly horizon: HorizonServer;
  /** Underlying Soroban RPC server instance. */
  readonly rpc: RpcServer;
  /** Sequence number cache, present only when enabled via options. */
  readonly sequenceCache?: SequenceNumberCache;

  constructor(opts: StellarClientOpts = {}) {
    const network = opts.network ?? "testnet";
    const defaults = resolveNetwork(network) ?? NETWORKS[network];

    this.config = {
      ...defaults,
      horizonUrl: opts.horizonUrl ?? defaults.horizonUrl,
      rpcUrl: opts.rpcUrl ?? defaults.rpcUrl,
    };

    this.horizon = new Horizon.Server(this.config.horizonUrl, {
      allowHttp: this.config.network === "local" || this.config.horizonUrl.startsWith("http://"),
    });
    this.rpc = new sorobanRpc.Server(this.config.rpcUrl, { allowHttp: this.config.network === "local" });

    if (opts.sequenceCache) {
      this.sequenceCache = new SequenceNumberCache(
        typeof opts.sequenceCache === "object" ? opts.sequenceCache : {},
      );
    }
  }

  /**
   * Generates a random identifier using the crypto adapter, which prefers
   * Web Crypto (`crypto.subtle`/`getRandomValues`) and falls back to Node.
   */
  randomId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** The network passphrase for the configured network. */
  get networkPassphrase(): string {
    return this.config.networkPassphrase;
  }

  /**
   * Loads an account's current sequence number, using the sequence cache when
   * it is enabled and populated. Falls back to Horizon on a cache miss.
   */
  async loadSequenceNumber(accountId: string): Promise<string> {
    const cached = this.sequenceCache?.get(accountId);
    if (cached !== null && cached !== undefined) return cached;

    const account = await this.horizon.loadAccount(accountId);
    const sequence = account.sequenceNumber();
    this.sequenceCache?.set(accountId, sequence);
    return sequence;
  }

  /**
   * Records that a transaction for the account was submitted, advancing the
   * cached sequence number locally when the cache is enabled.
   */
  recordSequenceNumber(accountId: string): void {
    this.sequenceCache?.increment(accountId);
  }
}
