/**
 * Names of the webhook events a subscription can listen for.
 *
 * Use `"*"` to subscribe to every event type.
 *
 * @example
 * ```ts
 * const events: WebhookEventType[] = ["wallet.created", "transaction.cosigned"];
 * const allEvents: WebhookEventType[] = ["*"];
 * ```
 */
export type WebhookEventType =
  | "wallet.created"
  | "transaction.cosigned"
  | "transaction.sponsored"
  | "transaction.fee_bump.submitted"
  | "policy.violated"
  | "balance.low"
  | "*";

/**
 * Payload `data` for `wallet.created`.
 *
 * @example
 * ```ts
 * const data: WalletCreatedEventData = {
 *   address: "GABC...XYZ",
 *   publicKey: "GABC...XYZ",
 * };
 * ```
 */
export interface WalletCreatedEventData {
  address: string;
  publicKey: string;
}

/**
 * Payload `data` for `transaction.cosigned`.
 *
 * @example
 * ```ts
 * const data: TransactionCosignedEventData = {
 *   walletAddress: "GABC...XYZ",
 *   txHash: "a1b2c3...",
 * };
 * ```
 */
export interface TransactionCosignedEventData {
  walletAddress: string;
  txHash: string;
}

/**
 * Payload `data` for `transaction.sponsored`.
 *
 * @example
 * ```ts
 * const data: TransactionSponsoredEventData = {
 *   feeSource: "GSPONSOR...XYZ",
 *   hash: "a1b2c3...",
 * };
 * ```
 */
export interface TransactionSponsoredEventData {
  feeSource: string;
  hash: string;
}

/**
 * Payload `data` for `transaction.fee_bump.submitted`.
 *
 * @example
 * ```ts
 * const data: TransactionFeeBumpSubmittedEventData = {
 *   feeSource: "GSPONSOR...XYZ",
 *   hash: "a1b2c3...",
 *   feeBumpHash: "d4e5f6...",
 * };
 * ```
 */
export interface TransactionFeeBumpSubmittedEventData {
  feeSource: string;
  hash: string;
  feeBumpHash: string;
}

/**
 * Payload `data` for `policy.violated`.
 *
 * @example
 * ```ts
 * const data: PolicyViolatedEventData = {
 *   walletAddress: "GABC...XYZ",
 *   reason: "spend limit exceeded",
 *   txHash: "a1b2c3...",
 * };
 * ```
 */
export interface PolicyViolatedEventData {
  walletAddress: string;
  reason?: string;
  txHash: string;
}

/**
 * Payload `data` for `balance.low`.
 *
 * @example
 * ```ts
 * const data: BalanceLowEventData = {
 *   sponsorPublicKey: "GSPONSOR...XYZ",
 *   balance: 12.5,
 *   threshold: 20,
 * };
 * ```
 */
export interface BalanceLowEventData {
  sponsorPublicKey: string;
  balance: number;
  threshold: number;
}

/**
 * Maps each concrete webhook event type to the shape of its payload `data`.
 *
 * @example
 * ```ts
 * function handle<E extends keyof WebhookEventDataMap>(
 *   event: E,
 *   data: WebhookEventDataMap[E],
 * ) {
 *   // data is narrowed to the payload for `event`
 * }
 * ```
 */
export interface WebhookEventDataMap {
  "wallet.created": WalletCreatedEventData;
  "transaction.cosigned": TransactionCosignedEventData;
  "transaction.sponsored": TransactionSponsoredEventData;
  "transaction.fee_bump.submitted": TransactionFeeBumpSubmittedEventData;
  "policy.violated": PolicyViolatedEventData;
  "balance.low": BalanceLowEventData;
}

/**
 * Configuration for a single webhook subscription.
 *
 * @example
 * ```ts
 * const config: WebhookConfig = {
 *   id: "wh_123",
 *   url: "https://example.com/hooks/stellar",
 *   secret: process.env.WEBHOOK_SECRET!,
 *   events: ["wallet.created", "transaction.sponsored"],
 *   enabled: true,
 * };
 * ```
 */
export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  enabled?: boolean;
}

/**
 * Envelope delivered to a webhook endpoint for a single event.
 *
 * @typeParam T - Shape of the `data` payload; see {@link WebhookEventDataMap}.
 *
 * @example
 * ```ts
 * const payload: WebhookPayload<WalletCreatedEventData> = {
 *   id: "evt_123",
 *   event: "wallet.created",
 *   timestamp: new Date().toISOString(),
 *   data: { address: "GABC...XYZ", publicKey: "GABC...XYZ" },
 * };
 * ```
 */
export interface WebhookPayload<T = unknown> {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  data: T;
}

/**
 * Outcome of a single webhook delivery attempt.
 *
 * @example
 * ```ts
 * const result: WebhookDeliveryResult = {
 *   webhookId: "wh_123",
 *   url: "https://example.com/hooks/stellar",
 *   success: true,
 *   statusCode: 200,
 *   attempts: 1,
 * };
 * ```
 */
export interface WebhookDeliveryResult {
  webhookId: string;
  url: string;
  success: boolean;
  statusCode?: number;
  attempts: number;
  error?: string;
}

/**
 * A persisted delivery log entry, extending {@link WebhookDeliveryResult}
 * with delivery metadata and the original event payload.
 *
 * @example
 * ```ts
 * const entry: WebhookDeliveryLogEntry = {
 *   deliveryId: "dlv_123",
 *   webhookId: "wh_123",
 *   url: "https://example.com/hooks/stellar",
 *   success: true,
 *   statusCode: 200,
 *   attempts: 1,
 *   event: "wallet.created",
 *   timestamp: "2024-01-01T00:00:00.000Z",
 *   deliveredAt: "2024-01-01T00:00:01.000Z",
 *   data: { address: "GABC...XYZ", publicKey: "GABC...XYZ" },
 * };
 * ```
 */
export interface WebhookDeliveryLogEntry extends WebhookDeliveryResult {
  deliveryId: string;
  event: WebhookEventType;
  timestamp: string;
  deliveredAt: string;
  data: unknown;
}

/**
 * Lifecycle status of a webhook delivery.
 *
 * @example
 * ```ts
 * const status: WebhookDeliveryStatus = "retrying";
 * ```
 */
export type WebhookDeliveryStatus =
  | "pending"
  | "retrying"
  | "delivered"
  | "failed"
  | "dead_lettered";

/**
 * Durable record tracking the retry/dead-letter state of a webhook delivery.
 *
 * @example
 * ```ts
 * const record: WebhookDeliveryRecord = {
 *   id: "dlv_123",
 *   webhookId: "wh_123",
 *   event: "transaction.sponsored",
 *   status: "pending",
 *   attempts: 0,
 *   deadLettered: false,
 *   createdAt: "2024-01-01T00:00:00.000Z",
 *   updatedAt: "2024-01-01T00:00:00.000Z",
 * };
 * ```
 */
export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  event: WebhookEventType;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastError?: string;
  nextRetryAt?: string;
  deadLettered: boolean;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}