/**
 * Discriminated union of the supported intent kinds.
 *
 * @example
 * const kind: Intent["type"] = "payment";
 */
export type IntentType = "payment" | "swap" | "contract_call";

/**
 * Generic intent envelope describing an action to be executed on Stellar.
 *
 * Use this when the concrete intent shape is not known ahead of time, or when
 * forwarding intents across a boundary (e.g. over the wire or through a queue).
 *
 * @example
 * const intent: Intent = {
 *   type: "payment",
 *   params: { asset: "XLM", amount: "10", destination: "G..." },
 * };
 */
export interface Intent {
  /** The kind of intent being described. */
  type: IntentType;
  /** Arbitrary parameters for the intent, shaped according to {@link Intent.type}. */
  params: Record<string, unknown>;
}

/**
 * Intent describing a single payment transfer.
 *
 * @example
 * const payment: PaymentIntent = {
 *   type: "payment",
 *   asset: "USDC:GA5Z...",
 *   amount: "25.00",
 *   destination: "GBZX...",
 *   memo: "invoice-42",
 * };
 */
export interface PaymentIntent {
  /** Always `"payment"` for this intent kind. */
  type: "payment";
  /** Asset identifier, e.g. `"XLM"` or `"CODE:ISSUER"`. */
  asset: string;
  /** Amount to send, as a decimal string in the asset's units. */
  amount: string;
  /** Stellar account (public key) receiving the payment. */
  destination: string;
  /** Optional memo attached to the transaction. */
  memo?: string;
}

/**
 * Intent describing a swap between two assets.
 *
 * @example
 * const swap: SwapIntent = {
 *   type: "swap",
 *   send: { asset: "XLM", amount: "100" },
 *   receive: { asset: "USDC:GA5Z...", min: "9.5" },
 * };
 */
export interface SwapIntent {
  /** Always `"swap"` for this intent kind. */
  type: "swap";
  /** The asset and amount being sent. */
  send: { asset: string; amount: string };
  /** The asset being received, with an optional minimum acceptable amount. */
  receive: { asset: string; min?: string };
}