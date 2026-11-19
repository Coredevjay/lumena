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
  | UsdSpendLimitRule
  | SorobanSimulationPolicyRule;

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
 * Soroban simulation resource limits (#503).
 *
 * Before cosigning a Soroban invocation the cosigner calls
 * `simulateTransaction` and compares the returned resource usage against these
 * limits. A failed simulation, or a simulation whose resource fee or resource
 * usage exceeds the configured limits, rejects the transaction.
 *
 * Defaults (applied when a field is omitted):
 * - `maxResourceFeeStroops`: 1_000_000 (0.1 XLM)
 * - `maxCpuInstructions`: 100_000_000
 * - `maxMemoryBytes`: 41_943_040 (40 MiB)
 * - `maxFootprintEntries`: unlimited
 *
 * @example
 * ```ts
 * const rule: SorobanSimulationPolicyRule = {
 *   type: "soroban_simulation",
 *   maxResourceFeeStroops: 500_000,
 *   maxCpuInstructions: 50_000_000,
 *   maxMemoryBytes: 20_971_520,
 *   maxFootprintEntries: 32,
 * };
 * ```
 */
export interface SorobanSimulationPolicyRule {
  /** Rule discriminator. */
  type: "soroban_simulation";
  /**
   * Maximum resource fee (in stroops) the simulation may report.
   * Defaults to 1_000_000 stroops (0.1 XLM).
   */
  maxResourceFeeStroops?: number;
  /**
   * Maximum CPU instructions the simulation may consume.
   * Defaults to 100_000_000.
   */
  maxCpuInstructions?: number;
  /**
   * Maximum memory (in bytes) the simulation may consume.
   * Defaults to 41_943_040 bytes (40 MiB).
   */
  maxMemoryBytes?: number;
  /**
   * Maximum number of ledger entries in the simulated read/write footprint.
   * Omitted means the footprint size is not limited.
   */
  maxFootprintEntries?: number;
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
  /**
   * Persists an immutable snapshot of a policy version (#500).
   *
   * @param version - The version snapshot to store.
   */
  savePolicyVersion?(version: PolicyVersion): Promise<void>;
  /**
   * Lists all stored versions for a policy, newest first (#500).
   *
   * @param policyId - Identifier of the policy.
   */
  listPolicyVersions?(policyId: string): Promise<PolicyVersion[]>;
  /**
   * Returns a single stored policy version, or `null` if not found (#500).
   *
   * @param policyId - Identifier of the policy.
   * @param version - Version number to fetch.
   */
  getPolicyVersion?(policyId: string, version: number): Promise<PolicyVersion | null>;
  /**
   * Rolls a policy back to a previously stored version (#500).
   *
   * @param policyId - Identifier of the policy.
   * @param version - Version number to restore.
   * @returns The restored policy, or `null` if the version does not exist.
   */
  rollbackPolicy?(policyId: string, version: number): Promise<Policy | null>;
  /**
   * Exports a policy in its serialisable form (#501).
   *
   * @param walletId - Wallet whose policy should be exported.
   */
  exportPolicy?(walletId: string): Promise<PolicyExport | null>;
  /**
   * Imports a serialisable policy for a wallet (#501).
   *
   * @param walletId - Wallet the policy should be applied to.
   * @param data - The exported policy payload.
   */
  importPolicy?(walletId: string, data: PolicyExport): Promise<Policy>;
}

/**
 * An immutable snapshot of a policy at a point in time (#500).
 *
 * @example
 * ```ts
 * const version: PolicyVersion = {
 *   id: "polv_123",
 *   policyId: "pol_123",
 *   version: 2,
 *   author: "admin@example.com",
 *   timestamp: new Date(),
 *   rules: [{ type: "max_operations", maxOperations: 5 }],
 * };
 * ```
 */
export interface PolicyVersion {
  /** Unique identifier of this version snapshot. */
  id: string;
  /** Identifier of the policy this version belongs to. */
  policyId: string;
  /** Monotonically increasing version number. */
  version: number;
  /** Author (user or service) that produced the change. */
  author: string;
  /** Timestamp at which the version was created. */
  timestamp: Date;
  /** Rules captured in this version. */
  rules: PolicyRule[];
}

/**
 * Names of the built-in policy templates (#501).
 */
export type PolicyTemplateName = "conservative" | "payroll" | "dapp-session";

/**
 * A named, reusable policy template (#501).
 *
 * @example
 * ```ts
 * const template: PolicyTemplate = {
 *   name: "conservative",
 *   description: "Low limits, strict allowlists.",
 *   rules: [{ type: "max_operations", maxOperations: 1 }],
 * };
 * ```
 */
export interface PolicyTemplate {
  /** Template identifier. */
  name: PolicyTemplateName;
  /** Human-readable description of the template. */
  description: string;
  /** Rules the template expands to. */
  rules: PolicyRule[];
}

/**
 * Serialisable policy shape used by import/export (#501).
 *
 * Timestamps are ISO-8601 strings so the payload is valid JSON.
 *
 * @example
 * ```ts
 * const exported: PolicyExport = {
 *   walletId: "wallet_abc",
 *   version: 1,
 *   rules: [{ type: "max_operations", maxOperations: 5 }],
 *   createdAt: new Date().toISOString(),
 * };
 * ```
 */
export interface PolicyExport {
  /** Wallet the policy applies to. */
  walletId: string;
  /** Version of the exported policy. */
  version: number;
  /** Rules contained in the exported policy. */
  rules: PolicyRule[];
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * Result of a single rule evaluation during a dry run (#499).
 */
export interface DryRunRuleResult {
  /** The rule that was evaluated. */
  rule: PolicyRule;
  /** Whether the rule passed. */
  passed: boolean;
  /** Optional human-readable explanation for the outcome. */
  reason?: string;
}

/**
 * Result of a dry-run policy evaluation (#499).
 *
 * @example
 * ```ts
 * const result: DryRunEvaluationResult = {
 *   approved: false,
 *   reason: "spend_limit exceeded",
 *   results: [{ rule: { type: "max_operations", maxOperations: 5 }, passed: true }],
 * };
 * ```
 */
export interface DryRunEvaluationResult {
  /** Whether the transaction would be approved. */
  approved: boolean;
  /** Overall reason for the decision, if any. */
  reason?: string;
  /** Per-rule evaluation results, including matched rules. */
  results: DryRunRuleResult[];
}
