/**
 * Lifecycle state of a wallet instance.
 *
 * - `"creating"` — the wallet is being provisioned (keys generated, funded).
 * - `"ready"` — the wallet is unlocked and can sign transactions.
 * - `"locked"` — the wallet exists but signing is disabled until unlocked.
 * - `"error"` — the wallet encountered an unrecoverable error.
 *
 * @example
 * ```ts
 * const state: WalletState = "ready";
 * if (state === "locked") {
 *   await wallet.unlock(passphrase);
 * }
 * ```
 */
export type WalletState = "creating" | "ready" | "locked" | "error";

/**
 * Configuration used to create a {@link WalletInstance}.
 *
 * @example
 * ```ts
 * const config: WalletConfig = {
 *   network: "testnet",
 *   horizonUrl: "https://horizon-testnet.stellar.org",
 *   rpcUrl: "https://soroban-testnet.stellar.org",
 * };
 * ```
 */
export interface WalletConfig {
  /**
   * Target Stellar network.
   *
   * - `"testnet"` — Stellar test network, safe for development.
   * - `"mainnet"` — Stellar public network, real funds.
   * - `"local"` — a locally running network (e.g. via `stellar quickstart`).
   *
   * @example
   * ```ts
   * const network: WalletConfig["network"] = "testnet";
   * ```
   */
  network: "testnet" | "mainnet" | "local";
  /**
   * Base URL of the Horizon API used for account and transaction queries.
   *
   * @example
   * ```ts
   * const horizonUrl = "https://horizon-testnet.stellar.org";
   * ```
   */
  horizonUrl: string;
  /**
   * Base URL of the Soroban RPC endpoint used for contract invocations.
   *
   * @example
   * ```ts
   * const rpcUrl = "https://soroban-testnet.stellar.org";
   * ```
   */
  rpcUrl: string;
}

/**
 * A live wallet instance created from a {@link WalletConfig}.
 *
 * @example
 * ```ts
 * const wallet: WalletInstance = {
 *   id: "wallet-1",
 *   address: "GABC...XYZ",
 *   state: "ready",
 *   createdAt: new Date(),
 * };
 * ```
 */
export interface WalletInstance {
  /** Unique identifier of the wallet instance. */
  id: string;
  /** Stellar account address (public key) controlled by this wallet. */
  address: string;
  /** Current lifecycle state of the wallet. */
  state: WalletState;
  /** Timestamp at which the wallet instance was created. */
  createdAt: Date;
}

/**
 * Status of a pending contract upgrade for the upgradeable proxy (#224).
 */
export type UpgradeState =
  | "none"
  | "pending"
  | "approved"
  | "executed"
  | "cancelled";

/**
 * Pending upgrade proposal tracked by the proxy contract (#224).
 *
 * The proxy uses `env.deployer().update_current_contract_wasm()` to swap the
 * contract logic while preserving instance and persistent storage. Upgrades
 * require multi-sig approval and a mandatory timelock before execution.
 */
export interface PendingUpgrade {
  /** Hex-encoded hash of the new WASM blob to be deployed. */
  wasmHash: string;
  /** Current status of the upgrade proposal. */
  state: UpgradeState;
  /** Addresses (signers) that have approved the upgrade so far. */
  approvals: string[];
  /** Number of approvals required before the upgrade can execute. */
  requiredApprovals: number;
  /** Unix timestamp (seconds) at which the timelock expires and execution is allowed. */
  unlockTimestamp: number;
  /** Unix timestamp (seconds) when the proposal was created. */
  proposedAt: number;
  /** Address that created the upgrade proposal. */
  proposer: string;
}

/**
 * Inheritance configuration for the dead-man's switch vault (#225).
 */
export interface InheritanceConfig {
  /** Address of the designated beneficiary allowed to claim custody. */
  beneficiary: string;
  /** Dormancy period in seconds; claim is allowed once inactivity exceeds this. */
  dormancyPeriod: number;
}

/**
 * Runtime inheritance state for the dead-man's switch vault (#225).
 */
export interface InheritanceState {
  /** Current inheritance configuration. */
  config: InheritanceConfig;
  /** Unix timestamp (seconds) of the last heartbeat (updated by wallet activity). */
  lastHeartbeat: number;
  /** Whether the beneficiary has already claimed custody. */
  claimed: boolean;
  /** Unix timestamp (seconds) when custody was claimed, if applicable. */
  claimedAt?: number;
}