/**
 * @packageDocumentation
 *
 * Public type definitions for the Stellar SDK packages.
 *
 * This module re-exports all public types from the individual type modules
 * (`stellar`, `wallet`, `intent`, `policy`, `signer`, `soroban`, and `webhook`).
 * Every export is documented with a description and a usage example so that
 * the generated TypeDoc reference is complete.
 */

/**
 * Supported Stellar networks.
 *
 * @example
 * ```ts
 * const network: StellarNetwork = "testnet";
 * ```
 */
export type { StellarNetwork } from "./stellar.js";

/**
 * Configuration for a Stellar client connection.
 *
 * @example
 * ```ts
 * const config: StellarConfig = {
 *   network: "testnet",
 *   rpcUrl: "https://soroban-testnet.stellar.org",
 *   timeoutMs: 30_000,
 * };
 * ```
 */
export type { StellarConfig } from "./stellar.js";

/**
 * Configuration for a transaction signer.
 *
 * @example
 * ```ts
 * const signer: SignerConfig = {
 *   publicKey: "G...",
 *   secretKey: "S...",
 * };
 * ```
 */
export type { SignerConfig } from "./stellar.js";

/**
 * Result of a submitted Stellar transaction.
 *
 * @example
 * ```ts
 * const result: TransactionResult = {
 *   hash: "abc123...",
 *   status: "success",
 *   ledger: 12345,
 * };
 * ```
 */
export type { TransactionResult } from "./stellar.js";

/**
 * Observable state of a wallet instance.
 *
 * @example
 * ```ts
 * const state: WalletState = {
 *   status: "connected",
 *   publicKey: "G...",
 * };
 * ```
 */
export type { WalletState } from "./wallet.js";

/**
 * Configuration used to create a wallet.
 *
 * @example
 * ```ts
 * const config: WalletConfig = {
 *   network: "testnet",
 *   sponsor: "G...",
 * };
 * ```
 */
export type { WalletConfig } from "./wallet.js";

/**
 * A wallet instance exposing signing and transaction helpers.
 *
 * @example
 * ```ts
 * const wallet: WalletInstance = await createWallet(config);
 * await wallet.sign(transaction);
 * ```
 */
export type { WalletInstance } from "./wallet.js";

/**
 * Base intent describing a desired on-chain action.
 *
 * @example
 * ```ts
 * const intent: Intent = {
 *   type: "payment",
 *   amount: "10",
 *   asset: "XLM",
 * };
 * ```
 */
export type { Intent } from "./intent.js";

/**
 * Intent describing a payment transfer.
 *
 * @example
 * ```ts
 * const intent: PaymentIntent = {
 *   type: "payment",
 *   destination: "G...",
 *   amount: "10",
 *   asset: "XLM",
 * };
 * ```
 */
export type { PaymentIntent } from "./intent.js";

/**
 * Intent describing an asset swap.
 *
 * @example
 * ```ts
 * const intent: SwapIntent = {
 *   type: "swap",
 *   fromAsset: "XLM",
 *   toAsset: "USDC",
 *   amount: "10",
 * };
 * ```
 */
export type { SwapIntent } from "./intent.js";

/**
 * A policy composed of one or more rules applied to intents.
 *
 * @example
 * ```ts
 * const policy: Policy = {
 *   id: "default",
 *   rules: [spendLimit, allowlist],
 * };
 * ```
 */
export type { Policy } from "./policy.js";

/**
 * A single rule within a policy.
 *
 * @example
 * ```ts
 * const rule: PolicyRule = {
 *   type: "spend-limit",
 *   limit: "100",
 * };
 * ```
 */
export type { PolicyRule } from "./policy.js";

/**
 * Rule limiting total spend over a period.
 *
 * @example
 * ```ts
 * const limit: SpendLimit = { amount: "100", period: "day" };
 * ```
 */
export type { SpendLimit } from "./policy.js";

/**
 * Rule limiting the number of operations within a time window.
 *
 * @example
 * ```ts
 * const rule: VelocityRule = { maxOperations: 5, windowMs: 60_000 };
 * ```
 */
export type { VelocityRule } from "./policy.js";

/**
 * Rule restricting destinations to an allowlist.
 *
 * @example
 * ```ts
 * const rule: AllowlistRule = { addresses: ["G..."] };
 * ```
 */
export type { AllowlistRule } from "./policy.js";

/**
 * Rule blocking destinations on a blocklist.
 *
 * @example
 * ```ts
 * const rule: BlocklistRule = { addresses: ["G..."] };
 * ```
 */
export type { BlocklistRule } from "./policy.js";

/**
 * Rule restricting which assets may be used.
 *
 * @example
 * ```ts
 * const rule: AssetAllowlistRule = { assets: ["XLM", "USDC"] };
 * ```
 */
export type { AssetAllowlistRule } from "./policy.js";

/**
 * Rule governing session key usage.
 *
 * @example
 * ```ts
 * const rule: SessionKeyPolicyRule = { maxUses: 10, expiresAt: Date.now() + 60_000 };
 * ```
 */
export type { SessionKeyPolicyRule } from "./policy.js";

/**
 * Rule constraining when a transaction may be submitted.
 *
 * @example
 * ```ts
 * const rule: TimeBoundsRule = { minTime: 0, maxTime: 1_700_000_000 };
 * ```
 */
export type { TimeBoundsRule } from "./policy.js";

/**
 * Rule limiting the number of operations per transaction.
 *
 * @example
 * ```ts
 * const rule: MaxOperationsRule = { maxOperations: 10 };
 * ```
 */
export type { MaxOperationsRule } from "./policy.js";

/**
 * Rule limiting the transaction fee.
 *
 * @example
 * ```ts
 * const rule: FeeLimitRule = { maxFee: "1000" };
 * ```
 */
export type { FeeLimitRule } from "./policy.js";

/**
 * Rule restricting which contracts may be invoked.
 *
 * @example
 * ```ts
 * const rule: ContractAllowlistRule = { contracts: ["C..."] };
 * ```
 */
export type { ContractAllowlistRule } from "./policy.js";

/**
 * Storage interface for persisting policies.
 *
 * @example
 * ```ts
 * const store: PolicyStore = {
 *   get: async (id) => policies[id],
 *   set: async (id, policy) => { policies[id] = policy; },
 * };
 * ```
 */
export type { PolicyStore } from "./policy.js";

/**
 * A signer capable of signing transactions or payloads.
 *
 * @example
 * ```ts
 * const signer: Signer = {
 *   publicKey: "G...",
 *   sign: async (data) => signature,
 * };
 * ```
 */
export type { Signer } from "./signer.js";

/**
 * Supported Soroban smart contract value types.
 *
 * @example
 * ```ts
 * const type: ScValType = "u32";
 * ```
 */
export type { ScValType } from "./soroban.js";

/**
 * Input value convertible to a Soroban `ScVal`.
 *
 * @example
 * ```ts
 * const input: ScValInput = { type: "u32", value: 42 };
 * ```
 */
export type { ScValInput } from "./soroban.js";

/**
 * A single argument passed to a contract invocation.
 *
 * @example
 * ```ts
 * const arg: ContractArg = { name: "amount", value: { type: "i128", value: "100" } };
 * ```
 */
export type { ContractArg } from "./soroban.js";

/**
 * Description of a Soroban contract invocation.
 *
 * @example
 * ```ts
 * const invocation: ContractInvocation = {
 *   contractId: "C...",
 *   method: "transfer",
 *   args: [],
 * };
 * ```
 */
export type { ContractInvocation } from "./soroban.js";

/**
 * Result of simulating a contract invocation.
 *
 * @example
 * ```ts
 * const result: ContractSimulationResult = {
 *   success: true,
 *   returnValue: { type: "bool", value: true },
 * };
 * ```
 */
export type { ContractSimulationResult } from "./soroban.js";

/**
 * Types of webhook events emitted by the SDK.
 *
 * @example
 * ```ts
 * const type: WebhookEventType = "transaction.cosigned";
 * ```
 */
export type { WebhookEventType } from "./webhook.js";

/**
 * Configuration for a webhook endpoint.
 *
 * @example
 * ```ts
 * const config: WebhookConfig = {
 *   url: "https://example.com/hooks",
 *   secret: "whsec_...",
 *   events: ["transaction.cosigned"],
 * };
 * ```
 */
export type { WebhookConfig } from "./webhook.js";

/**
 * Payload delivered to a webhook endpoint.
 *
 * @example
 * ```ts
 * const payload: WebhookPayload = {
 *   id: "evt_123",
 *   type: "transaction.cosigned",
 *   data: { transactionHash: "abc..." },
 * };
 * ```
 */
export type { WebhookPayload } from "./webhook.js";

/**
 * Result of a webhook delivery attempt.
 *
 * @example
 * ```ts
 * const result: WebhookDeliveryResult = {
 *   success: true,
 *   statusCode: 200,
 * };
 * ```
 */
export type { WebhookDeliveryResult } from "./webhook.js";

/**
 * A single entry in the webhook delivery log.
 *
 * @example
 * ```ts
 * const entry: WebhookDeliveryLogEntry = {
 *   eventId: "evt_123",
 *   attempt: 1,
 *   deliveredAt: Date.now(),
 * };
 * ```
 */
export type { WebhookDeliveryLogEntry } from "./webhook.js";

/**
 * Mapping of webhook event types to their data shapes.
 *
 * @example
 * ```ts
 * const data: WebhookEventDataMap["transaction.cosigned"] = {
 *   transactionHash: "abc...",
 * };
 * ```
 */
export type { WebhookEventDataMap } from "./webhook.js";

/**
 * Data for a `wallet.created` webhook event.
 *
 * @example
 * ```ts
 * const data: WalletCreatedEventData = { publicKey: "G..." };
 * ```
 */
export type { WalletCreatedEventData } from "./webhook.js";

/**
 * Data for a `transaction.cosigned` webhook event.
 *
 * @example
 * ```ts
 * const data: TransactionCosignedEventData = { transactionHash: "abc..." };
 * ```
 */
export type { TransactionCosignedEventData } from "./webhook.js";

/**
 * Data for a `transaction.sponsored` webhook event.
 *
 * @example
 * ```ts
 * const data: TransactionSponsoredEventData = {
 *   transactionHash: "abc...",
 *   sponsor: "G...",
 * };
 * ```
 */
export type { TransactionSponsoredEventData } from "./webhook.js";

/**
 * Data for a `transaction.feeBumpSubmitted` webhook event.
 *
 * @example
 * ```ts
 * const data: TransactionFeeBumpSubmittedEventData = {
 *   transactionHash: "abc...",
 *   feeBumpHash: "def...",
 * };
 * ```
 */
export type { TransactionFeeBumpSubmittedEventData } from "./webhook.js";

/**
 * Data for a `policy.violated` webhook event.
 *
 * @example
 * ```ts
 * const data: PolicyViolatedEventData = {
 *   policyId: "default",
 *   ruleType: "spend-limit",
 * };
 * ```
 */
export type { PolicyViolatedEventData } from "./webhook.js";

/**
 * Data for a `balance.low` webhook event.
 *
 * @example
 * ```ts
 * const data: BalanceLowEventData = {
 *   asset: "XLM",
 *   balance: "1",
 *   threshold: "5",
 * };
 * ```
 */
export type { BalanceLowEventData } from "./webhook.js";