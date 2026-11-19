import type { WebhookEventDataMap, WebhookPayload } from "@lumen/types";

export type ConcreteWebhookEventType = keyof WebhookEventDataMap;

interface WebhookEventDoc<E extends ConcreteWebhookEventType> {
  /** When the event is dispatched. */
  description: string;
  /** Field-by-field description of the payload `data`. */
  fields: Record<keyof WebhookEventDataMap[E], string>;
  /** Example payload as delivered to a webhook endpoint. */
  example: WebhookPayload<WebhookEventDataMap[E]> & { event: E };
}

/** Documentation and example payload for every webhook event type. */
export const WEBHOOK_EVENTS: { [E in ConcreteWebhookEventType]: WebhookEventDoc<E> } = {
  "wallet.created": {
    description: "A new wallet account was created through `POST /wallet/create`.",
    fields: {
      address: "Stellar address of the new wallet account.",
      publicKey: "Public key of the wallet owner.",
    },
    example: {
      id: "5f0c6d2e-3b1a-4c8e-9d7f-1a2b3c4d5e6f",
      event: "wallet.created",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        publicKey: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      },
    },
  },
  "transaction.cosigned": {
    description: "The co-signer approved and signed a transaction (single or batch).",
    fields: {
      walletAddress: "Wallet account that submitted the transaction.",
      txHash: "Hex-encoded hash of the co-signed transaction.",
    },
    example: {
      id: "8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      event: "transaction.cosigned",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        walletAddress: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        txHash: "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
      },
    },
  },
  "transaction.sponsored": {
    description: "A transaction was submitted with its fee paid by the sponsor account.",
    fields: {
      feeSource: "Public key of the sponsor account that paid the fee.",
      hash: "Hash of the submitted transaction.",
    },
    example: {
      id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      event: "transaction.sponsored",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        feeSource: "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A",
        hash: "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
      },
    },
  },
  "transaction.fee_bump.submitted": {
    description: "A fee-bump transaction was accepted by the network via `POST /fee-bump/submit`.",
    fields: {
      feeSource: "Public key of the sponsor account that paid the fee.",
      hash: "Hash of the submitted transaction.",
      feeBumpHash: "Hash of the fee-bump envelope.",
    },
    example: {
      id: "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f",
      event: "transaction.fee_bump.submitted",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        feeSource: "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A",
        hash: "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
        feeBumpHash: "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
      },
    },
  },
  "policy.violated": {
    description: "The policy engine rejected a transaction submitted for co-signing.",
    fields: {
      walletAddress: "Wallet account that submitted the transaction.",
      reason: "Human-readable reason the policy rejected the transaction (optional).",
      txHash: "Hex-encoded hash of the rejected transaction.",
    },
    example: {
      id: "d4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f8a",
      event: "policy.violated",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        walletAddress: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        reason: "Exceeds per-transaction spend limit",
        txHash: "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
      },
    },
  },
  "balance.low": {
    description: "The sponsor account's native balance dropped below the configured minimum.",
    fields: {
      sponsorPublicKey: "Public key of the sponsor account.",
      balance: "Current native balance in XLM.",
      threshold: "Configured minimum balance in XLM.",
    },
    example: {
      id: "e5f6a7b8-c9d0-4e1f-8a2b-4c5d6e7f8a9b",
      event: "balance.low",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        sponsorPublicKey: "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A",
        balance: 42.5,
        threshold: 50,
      },
    },
  },
};

/** Renders `docs/webhooks.md` from {@link WEBHOOK_EVENTS}. */
export function renderWebhookDocs(): string {
  const lines: string[] = [
    "# Webhooks",
    "",
    "<!-- Generated from packages/server/src/webhook/events.ts. Run `vitest -u` in packages/server to update. -->",
    "",
    "Lumen delivers webhook events as `POST` requests with a JSON body:",
    "",
    "```json",
    JSON.stringify(
      { id: "<uuid>", event: "<event type>", timestamp: "<ISO 8601>", data: {} },
      null,
      2,
    ),
    "```",
    "",
    "## Delivery semantics",
    "",
    "Each request carries the following headers:",
    "",
    "| Header | Description |",
    "| --- | --- |",
    "| `Content-Type` | Always `application/json`. |",
    "| `X-Lumen-Signature` | `sha256=<hex>` HMAC-SHA256 of the raw body using the webhook secret. |",
    "| `X-Lumen-Event` | The event type, identical to `event` in the body. |",
    "| `X-Lumen-Delivery` | The delivery id, identical to `id` in the body. Use it to deduplicate. |",
    "| `X-Lumen-Attempt` | The 1-based attempt number. |",
    "",
    "- A delivery succeeds when the endpoint responds with a 2xx status. Requests time out after 5 seconds by default.",
    "- Without a persistent queue, failed deliveries are retried up to 3 times with exponential backoff (200 ms, then doubling).",
    "- With the persistent (BullMQ) queue, failed deliveries are retried after 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours, then routed to the dead-letter queue.",
    "- 4xx responses other than `429` are treated as permanent failures and are not retried.",
    "- Delivery is at-least-once: the same `id` may be delivered more than once.",
    "- Subscribing to `*` delivers every event type.",
    "",
    "## Event types",
    "",
  ];

  for (const [event, doc] of Object.entries(WEBHOOK_EVENTS) as [
    ConcreteWebhookEventType,
    WebhookEventDoc<ConcreteWebhookEventType>,
  ][]) {
    lines.push(
      `### \`${event}\``,
      "",
      doc.description,
      "",
      "| Field | Description |",
      "| --- | --- |",
    );
    for (const [field, description] of Object.entries(doc.fields)) {
      lines.push(`| \`data.${field}\` | ${description} |`);
    }
    lines.push("", "```json", JSON.stringify(doc.example, null, 2), "```", "");
  }

  return lines.join("\n");
}
