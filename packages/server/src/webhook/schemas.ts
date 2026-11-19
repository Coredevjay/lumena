import { z } from "zod";
import type { ConcreteWebhookEventType } from "./events.js";

const stellarPublicKey = z.string().regex(/^G[A-Z2-7]{55}$/, "must be a Stellar public key");
const txHash = z.string().regex(/^[0-9a-f]{64}$/, "must be a hex-encoded transaction hash");

/** Zod schemas for the `data` of every webhook event type. */
export const WEBHOOK_EVENT_DATA_SCHEMAS: Record<ConcreteWebhookEventType, z.ZodType> = {
  "wallet.created": z.strictObject({
    address: stellarPublicKey,
    publicKey: stellarPublicKey,
  }),
  "transaction.cosigned": z.strictObject({
    walletAddress: stellarPublicKey,
    txHash,
  }),
  "transaction.sponsored": z.strictObject({
    feeSource: stellarPublicKey,
    hash: txHash,
  }),
  "transaction.fee_bump.submitted": z.strictObject({
    feeSource: stellarPublicKey,
    hash: txHash,
    feeBumpHash: txHash,
  }),
  "policy.violated": z.strictObject({
    walletAddress: stellarPublicKey,
    reason: z.string().optional(),
    txHash,
  }),
  "balance.low": z.strictObject({
    sponsorPublicKey: stellarPublicKey,
    balance: z.number(),
    threshold: z.number(),
  }),
};

/** Builds the full payload schema (envelope + `data`) for a webhook event type. */
export function webhookPayloadSchema(event: ConcreteWebhookEventType) {
  return z.strictObject({
    id: z.uuid(),
    event: z.literal(event),
    timestamp: z.iso.datetime(),
    data: WEBHOOK_EVENT_DATA_SCHEMAS[event],
  });
}
