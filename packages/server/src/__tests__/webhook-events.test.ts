import { describe, it, expect } from "vitest";
import type { WebhookEventType } from "@lumen/types";
import {
  WEBHOOK_EVENTS,
  renderWebhookDocs,
  type ConcreteWebhookEventType,
} from "../webhook/events.js";
import { webhookPayloadSchema } from "../webhook/schemas.js";
import { WebhookDispatcher } from "../webhook/dispatcher.js";

const EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as ConcreteWebhookEventType[];

describe("webhook event types", () => {
  it("documents every concrete webhook event type", () => {
    const allEvents: Record<Exclude<WebhookEventType, "*">, true> = {
      "wallet.created": true,
      "transaction.cosigned": true,
      "transaction.sponsored": true,
      "transaction.fee_bump.submitted": true,
      "policy.violated": true,
      "balance.low": true,
    };

    expect(EVENT_TYPES.sort()).toEqual(Object.keys(allEvents).sort());
  });

  it.each(EVENT_TYPES)("validates the %s example payload against its schema", (event) => {
    const { example } = WEBHOOK_EVENTS[event];

    expect(example.event).toBe(event);
    expect(webhookPayloadSchema(event).safeParse(example).success).toBe(true);
  });

  it.each(EVENT_TYPES)("validates a dispatcher-built %s payload against its schema", (event) => {
    const payload = new WebhookDispatcher().createPayload(
      event,
      WEBHOOK_EVENTS[event].example.data,
    );

    expect(webhookPayloadSchema(event).safeParse(payload).success).toBe(true);
  });

  it("rejects payloads with missing or unexpected data fields", () => {
    const { example } = WEBHOOK_EVENTS["transaction.cosigned"];
    const schema = webhookPayloadSchema("transaction.cosigned");

    const missingField = { ...example, data: { walletAddress: example.data.walletAddress } };
    const extraField = { ...example, data: { ...example.data, extra: 1 } };

    expect(schema.safeParse(missingField).success).toBe(false);
    expect(schema.safeParse(extraField).success).toBe(false);
  });

  it("keeps docs/webhooks.md in sync with the event definitions", async () => {
    await expect(renderWebhookDocs()).toMatchFileSnapshot("../../../../docs/webhooks.md");
  });
});
