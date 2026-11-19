/**
 * A wallet policy: an ordered set of rules evaluated on every transaction.
 *
 * @example
 * ```ts
 * const policy: Policy = {
 *   id: "pol_123",
 *   walletId: "wallet_abc",
 *   rules: [{ type: "spend_limit", asset: "XLM", maxPerTx: "100", maxDaily: "500" }],
 *   createdAt: new Date(),
 *   version: 1,
 * };
 * ```
 */
export interface Policy {
  /** Unique policy identifier. */
  id: string;
  /** Identifier of the wallet this policy applies to. */
  walletId: string;
  /** Rules evaluated in order; the first failing rule rejects the transaction. */
  rules: PolicyRule[];
  /** Timestamp at which the policy was created. */
  createdAt: Date;
  /**
   * Optimistic concurrency version. Starts at 1 when the policy is created and
   * is incremented on every update. Used to detect lost updates via If-Match.
   */
  version: number;
}

/**
 * Discriminated union of all supported policy rules.
 *
 * @example
 * ```ts
 * const rule: PolicyRule = { type: "velocity", maxTransactions: 10, windowMinutes: 60 };
 * ```
 */
export type PolicyRule =
  | SpendLimit
  | VelocityRule
  | AllowlistRule
  | BlocklistRule
  | AssetAllowlistRule
  | SessionKeyPolicyRule
  | TimeBoundsRule
  | MaxOperationsRule
  | FeeLimitRule
  | ContractAllowlistRule
  | ContractInvocationPolicyRule
  | UsdSpendLimitRule;

/**
 * Per-asset spend limit.
 *
 * @example
 * ```ts
 * const rule: SpendLimit = { type: "spend_limit", asset: "XLM", maxPerTx: "100", maxDaily: "500" };
 * ```
 */
export interface SpendLimit {
  /** Rule discriminator. */
  type: "spend_limit";
  /** Asset code or identifier the limit applies to. */
  asset: string;
  /** Maximum amount allowed per transaction (decimal string). */
  maxPerTx: string;
  /** Maximum amount allowed per rolling day (decimal string). */
  maxDaily: string;
}

/**
 * Limits the number of transactions within a rolling time window.
 *
 * @example
 * ```ts
 * const rule: VelocityRule = { type: "velocity", maxTransactions: 10, windowMinutes: 60 };
 * ```
 */
export interface VelocityRule {
  /** Rule discriminator. */
  type: "velocity";
  /** Maximum number of transactions permitted in the window. */
  maxTransactions: number;
  /** Length of the rolling window, in minutes. */
  windowMinutes: number;
}

/**
 * Only allows payments to the listed destinations.
 *
 * @example
 * ```ts
 * const rule: AllowlistRule = { type: "allowlist", destinations: ["GABC..."] };
 * ```
 */
export interface AllowlistRule {
  /** Rule discriminator. */
  type: "allowlist";
  /** Allowed destination account addresses. */
  destinations: string[];
}

/**
 * Rejects payments to the listed destinations.
 *
 * @example
 * ```ts
 * const rule: BlocklistRule = { type: "blocklist", destinations: ["GABC..."] };
 * ```
 */
export interface BlocklistRule {
  /** Rule discriminator. */
  type: "blocklist";
  /** Blocked destination account addresses. */
  destinations: string[];
}

/**
 * Only allows the listed assets to be transferred.
 *
 * @example
 * ```ts
 * const rule: AssetAllowlistRule = { type: "asset_allowlist", assets: ["XLM", "USDC"] };
 * ```
 */
export interface AssetAllowlistRule {
  /** Rule discriminator. */
  type: "asset_allowlist";
  /** Allowed asset codes or identifiers. */
  assets: string[];
}

/**
 * Restricts spending to a session key with a cap and expiry.
 *
 * @example
 * ```ts
 * const rule: SessionKeyPolicyRule = {
 *   type: "session_key",
 *   sessionPublicKey: "GABC...",
 *   maxSpend: "50",
 *   expiresAt: Date.now() + 3_600_000,
 * };
 * ```
 */
export interface SessionKeyPolicyRule {
  /** Rule discriminator. */
  type: "session_key";
  /** Public key of the authorized session key. */
  sessionPublicKey: string;
  /** Maximum total spend allowed under the session key (decimal string). */
  maxSpend: string;
  /** Expiry timestamp of the session key, in milliseconds since epoch. */
  expiresAt: number;
}

/**
 * Constrains the time bounds of a transaction.
 *
 * @example
 * ```ts
 * const rule: TimeBoundsRule = { type: "timebounds", maxWindowSeconds: 300 };
 * ```
 */
export interface TimeBoundsRule {
  /** Rule discriminator. */
  type: "timebounds";
  /** Maximum allowed difference between min and max time bounds, in seconds. */
  maxWindowSeconds?: number;
  /** Whether transactions without time bounds are permitted. */
  allowUnbounded?: boolean;
}

/**
 * Limits the number of operations in a transaction.
 *
 * @example
 * ```ts
 * const rule: MaxOperationsRule = { type: "max_operations", maxOperations: 5 };
 * ```
 */
export interface MaxOperationsRule {
  /** Rule discriminator. */
  type: "max_operations";
  /** Maximum number of operations allowed per transaction. */
  maxOperations: number;
}

/**
 * Caps the transaction fee.
 *
 * @example
 * ```ts
 * const rule: FeeLimitRule = { type: "fee_limit", maxFeeStroops: 1000 };
 * ```
 */
export interface FeeLimitRule {
  /** Rule discriminator. */
  type: "fee_limit";
  /** Maximum fee allowed per transaction, in stroops. */
  maxFeeStroops: number;
}

/**
 * Only allows invocations of the listed contracts (and optionally methods).
 *
 * @example
 * ```ts
 * const rule: ContractAllowlistRule = {
 *   type: "contract_allowlist",
 *   allowedContracts: [{ contractId: "CABC...", methods: ["transfer"] }],
 * };
 * ```
 */
export interface ContractAllowlistRule {
  /** Rule discriminator. */
  type: "contract_allowlist";
  /** Contracts (and optional method allowlists) that may be invoked. */
  allowedContracts: Array<{
    contractId: string;
    /** If omitted or empty, all methods are allowed for this contract. */
    methods?: string[];
  }>;
}

/**
 * Cross-contract invocation policy (#222).
 *
 * Enforces that every sub-contract dispatched by the wallet is registered in
 * the on-chain verified contract registry and, optionally, that the invoked
 * method is explicitly authorized.
 */
export interface ContractInvocationPolicyRule {
  type: "contract_invocation";
  /** Address of the on-chain verified contract registry contract. */
  registryContractId: string;
  /** If true, only contracts present in the registry may be invoked. */
  requireVerified: boolean;
  /** Optional per-contract method allowlist; empty/omitted means all methods. */
  authorizedTargets?: Array<{
    contractId: string;
    /** Expected verified source-code hash (hex) for the target contract. */
    codeHash?: string;
    /** If omitted or empty, all methods are allowed for this contract. */
    methods?: string[];
  }>;
}

/**
 * USD-denominated spend limit backed by an on-chain price oracle (#223).
 *
 * Asset amounts are converted to USD using the configured oracle before the
 * payment is authorized. Stale or missing prices cause a safe failure.
 */
export interface UsdSpendLimitRule {
  type: "usd_spend_limit";
  /** Address of the oracle price-feed consumer contract. */
  oracleContractId: string;
  /** Maximum acceptable age of an oracle price, in seconds. */
  maxPriceAgeSeconds: number;
  /** Maximum USD value allowed per transaction (decimal string). */
  maxPerTxUsd: string;
  /** Maximum USD value allowed per rolling day (decimal string). */
  maxDailyUsd: string;
  /** Assets subject to the USD limit; empty/omitted means all assets. */
  assets?: string[];
}

/**
 * Persistence and accounting backend for wallet policies.
 *
 * @example
 * ```ts
 * class InMemoryPolicyStore implements PolicyStore {
 *   async getPolicy(walletId: string) { return null; }
 *   async savePolicy(policy: Policy) {}
 *   async deletePolicy(walletId: string) {}
 *   async listPolicies() { return []; }
 *   async recordSpend() { return { dailyTotal: 0, txCount: 0 }; }
 *   async recordVelocity() { return 0; }
 * }
 * ```
 */
export interface PolicyStore {
  /** Returns the policy for a wallet, or `null` if none exists. */
  getPolicy(walletId: string): Promise<Policy | null>;
  /** Persists (creates or updates) a policy. */
  savePolicy(policy: Policy): Promise<void>;
  /** Deletes the policy for a wallet. */
  deletePolicy(walletId: string): Promise<void>;
  /** Lists all stored policies. */
  listPolicies(): Promise<Policy[]>;
  /**
   * Records a spend and returns the updated daily total and transaction count.
   *
   * @param walletId - Wallet the spend belongs to.
   * @param date - Day bucket (e.g. `YYYY-MM-DD`).
   * @param amount - Amount spent.
   * @param asset - Optional asset the amount is denominated in.
   */
  recordSpend(
    walletId: string,
    date: string,
    amount: number,
    asset?: string,
  ): Promise<{ dailyTotal: number; txCount: number }>;
  /**
   * Records a transaction timestamp for velocity tracking.
   *
   * @returns The number of transactions within the given window.
   */
  recordVelocity(walletId: string, timestamp: number, windowMs: number): Promise<number>;
}
