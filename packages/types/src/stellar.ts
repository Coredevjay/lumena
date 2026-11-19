/**
 * Supported Stellar networks.
 *
 * @remarks
 * - `"testnet"` — Stellar test network, safe for development and testing.
 * - `"mainnet"` — Stellar public network, real assets and real value.
 * - `"local"` — A locally running Stellar network (e.g. via Docker or `stellar quickstart`).
 * - `"futurenet"` — Stellar's experimental network for upcoming protocol features.
 *
 * @example
 * ```ts
 * const network: StellarNetwork = "testnet";
 * ```
 */
export type StellarNetwork = "testnet" | "mainnet" | "local" | "futurenet";

/**
 * Configuration for a transaction signer.
 *
 * @remarks
 * A signer is identified by its public key and carries a weight that
 * contributes to meeting the account's signing thresholds.
 *
 * @example
 * ```ts
 * const signer: SignerConfig = {
 *   publicKey: "GABCD...XYZ",
 *   weight: 1,
 * };
 * ```
 */
export interface SignerConfig {
  /**
   * The Stellar public key (account ID) of the signer, e.g. `"GABCD...XYZ"`.
   */
  publicKey: string;

  /**
   * The signing weight of this signer. Higher weights contribute more toward
   * meeting the account's signing thresholds.
   */
  weight: number;
}

/**
 * The result of a submitted Stellar transaction.
 *
 * @example
 * ```ts
 * const result: TransactionResult = {
 *   hash: "abc123...",
 *   ledger: 123456,
 *   success: true,
 * };
 * ```
 */
export interface TransactionResult {
  /**
   * The transaction hash.
   */
  hash: string;

  /**
   * The ledger sequence number in which the transaction was included.
   */
  ledger: number;

  /**
   * Whether the transaction succeeded.
   */
  success: boolean;

  /**
   * An optional error message describing why the transaction failed.
   * Present only when {@link TransactionResult.success} is `false`.
   */
  error?: string;
}

/**
 * Network configuration describing the endpoints and passphrase for a
 * Stellar network. This is the canonical shape reused by the core
 * `networks.ts` module and downstream packages.
 */
export interface NetworkConfig {
  network: StellarNetwork;

  /**
   * The base URL of the Horizon API for the selected network.
   *
   * @example
   * ```ts
   * const horizonUrl = "https://horizon-testnet.stellar.org";
   * ```
   */
  horizonUrl: string;

  /**
   * The base URL of the Soroban RPC endpoint for the selected network.
   *
   * @example
   * ```ts
   * const rpcUrl = "https://soroban-testnet.stellar.org";
   * ```
   */
  rpcUrl: string;

  /**
   * The network passphrase used to sign transactions for the selected network.
   *
   * @example
   * ```ts
   * const networkPassphrase = "Test SDF Network ; September 2015";
   * ```
   */
  networkPassphrase: string;
}

/**
 * Stellar configuration. Kept structurally compatible with
 * `NetworkConfig` so downstream packages can import either type from
 * `@lumen/types`.
 */
export interface StellarConfig extends NetworkConfig {}