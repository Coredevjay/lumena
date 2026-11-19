export type WebhookEventType =
  | "wallet.created"
  | "transaction.cosigned"
  | "transaction.sponsored"
  | "transaction.fee_bump.submitted"
  | "policy.violated"
  | "balance.low"
  | "*";

/** Payload `data` for `wallet.created`. */
export interface WalletCreatedEventData {
  address: string;
  publicKey: string;
}

/** Payload `data` for `transaction.cosigned`. */
export interface TransactionCosignedEventData {
  walletAddress: string;
  txHash: string;
}

/** Payload `data` for `transaction.sponsored`. */
export interface TransactionSponsoredEventData {
  feeSource: string;
  hash: string;
}

/** Payload `data` for `transaction.fee_bump.submitted`. */
export interface TransactionFeeBumpSubmittedEventData {
  feeSource: string;
  hash: string;
  feeBumpHash: string;
}

/** Payload `data` for `policy.violated`. */
export interface PolicyViolatedEventData {
  walletAddress: string;
  reason?: string;
  txHash: string;
}

/** Payload `data` for `balance.low`. */
export interface BalanceLowEventData {
  sponsorPublicKey: string;
  balance: number;
  threshold: number;
}

/** Maps each concrete webhook event type to the shape of its payload `data`. */
export interface WebhookEventDataMap {
  "wallet.created": WalletCreatedEventData;
  "transaction.cosigned": TransactionCosignedEventData;
  "transaction.sponsored": TransactionSponsoredEventData;
  "transaction.fee_bump.submitted": TransactionFeeBumpSubmittedEventData;
  "policy.violated": PolicyViolatedEventData;
  "balance.low": BalanceLowEventData;
}

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  enabled?: boolean;
}

export interface WebhookPayload<T = unknown> {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  data: T;
}

export interface WebhookDeliveryResult {
  webhookId: string;
  url: string;
  success: boolean;
  statusCode?: number;
  attempts: number;
  error?: string;
}

export interface WebhookDeliveryLogEntry extends WebhookDeliveryResult {
  deliveryId: string;
  event: WebhookEventType;
  timestamp: string;
  deliveredAt: string;
  data: unknown;
}

export type WebhookDeliveryStatus =
  | "pending"
  | "retrying"
  | "delivered"
  | "failed"
  | "dead_lettered";

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