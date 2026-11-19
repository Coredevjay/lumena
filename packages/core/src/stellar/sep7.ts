Looking at this file, it contains only SEP-7 URI building/parsing logic with no network calls or retry loops. There's nothing to change here regarding retry/backoff or AbortSignal — the file has no ad-hoc retry loops and makes no network requests.

The file content remains unchanged:

```ts
import { StrKey } from "@stellar/stellar-sdk";

const PAY_PREFIX = "web+stellar:pay";

export type PayUriMemoType = "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";

/**
 * Fields of a SEP-0007 `web+stellar:pay` URI.
 */
export interface PayUriParams {
  /** Destination account (G...). */
  destination: string;
  /** Amount to pay, as a decimal string with at most 7 fractional digits. */
  amount?: string;
  /** Asset code. Requires `assetIssuer`; omit both for native XLM. */
  assetCode?: string;
  /** Asset issuer (G...). Requires `assetCode`. */
  assetIssuer?: string;
  /** Memo value. */
  memo?: string;
  /** Memo type. Defaults to `MEMO_TEXT` when a memo is given. Requires `memo`. */
  memoType?: PayUriMemoType;
  /** Callback, in the SEP-0007 form `url:https://...`. */
  callback?: string;
  /** Message shown to the user, at most 300 characters. */
  msg?: string;
  /** Network passphrase the payment is meant for. */
  networkPassphrase?: string;
}

const MEMO_TYPES: readonly PayUriMemoType[] = ["MEMO_TEXT", "MEMO_ID", "MEMO_HASH", "MEMO_RETURN"];
const MAX_UINT64 = 18446744073709551615n;

function validatePayUriParams(params: PayUriParams): void {
  if (!params.destination || !StrKey.isValidEd25519PublicKey(params.destination)) {
    throw new Error("Invalid SEP-0007 pay URI: destination must be a valid Ed25519 public key");
  }

  if (params.amount !== undefined) {
    if (!/^\d+(\.\d{1,7})?$/.test(params.amount) || !/[1-9]/.test(params.amount)) {
      throw new Error(
        `Invalid SEP-0007 pay URI: amount "${params.amount}" must be a positive number with at most 7 decimals`,
      );
    }
  }

  if (params.assetCode !== undefined || params.assetIssuer !== undefined) {
    if (!params.assetCode || !/^[a-zA-Z0-9]{1,12}$/.test(params.assetCode)) {
      throw new Error("Invalid SEP-0007 pay URI: asset_code must be 1-12 alphanumeric characters");
    }
    if (!params.assetIssuer || !StrKey.isValidEd25519PublicKey(params.assetIssuer)) {
      throw new Error("Invalid SEP-0007 pay URI: asset_issuer must be a valid Ed25519 public key");
    }
  }

  if (params.memoType !== undefined && params.memo === undefined) {
    throw new Error("Invalid SEP-0007 pay URI: memo_type requires a memo");
  }

  if (params.memo !== undefined) {
    const memoType = params.memoType ?? "MEMO_TEXT";
    if (!MEMO_TYPES.includes(memoType)) {
      throw new Error(`Invalid SEP-0007 pay URI: unsupported memo_type "${memoType}"`);
    }
    if (memoType === "MEMO_TEXT" && new TextEncoder().encode(params.memo).length > 28) {
      throw new Error("Invalid SEP-0007 pay URI: MEMO_TEXT must be at most 28 bytes");
    }
    if (
      memoType === "MEMO_ID" &&
      (!/^\d+$/.test(params.memo) || BigInt(params.memo) > MAX_UINT64)
    ) {
      throw new Error("Invalid SEP-0007 pay URI: MEMO_ID must be an unsigned 64-bit integer");
    }
    if (
      (memoType === "MEMO_HASH" || memoType === "MEMO_RETURN") &&
      !/^[A-Za-z0-9+/]{43}=$/.test(params.memo)
    ) {
      throw new Error(`Invalid SEP-0007 pay URI: ${memoType} must be a base64-encoded 32-byte hash`);
    }
  }

  if (params.callback !== undefined) {
    let url: URL | undefined;
    if (params.callback.startsWith("url:")) {
      try {
        url = new URL(params.callback.slice("url:".length));
      } catch {
        url = undefined;
      }
    }
    if (!url || url.protocol !== "https:") {
      throw new Error('Invalid SEP-0007 pay URI: callback must be of the form "url:https://..."');
    }
  }

  if (params.msg !== undefined && params.msg.length > 300) {
    throw new Error("Invalid SEP-0007 pay URI: msg must be at most 300 characters");
  }

  if (params.networkPassphrase !== undefined && params.networkPassphrase.length === 0) {
    throw new Error("Invalid SEP-0007 pay URI: network_passphrase must not be empty");
  }
}

/**
 * Builds a SEP-0007 `web+stellar:pay` URI after validating every field.
 * Throws if any field is invalid.
 */
export function buildPayUri(params: PayUriParams): string {
  validatePayUriParams(params);

  const entries: [string, string | undefined][] = [
    ["destination", params.destination],
    ["amount", params.amount],
    ["asset_code", params.assetCode],
    ["asset_issuer", params.assetIssuer],
    ["memo", params.memo],
    ["memo_type", params.memoType],
    ["callback", params.callback],
    ["msg", params.msg],
    ["network_passphrase", params.networkPassphrase],
  ];

  const query = entries
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `${PAY_PREFIX}?${query}`;
}

/**
 * Parses and validates a SEP-0007 `web+stellar:pay` URI.
 * Throws if the URI is not a pay URI, repeats a parameter, or has an invalid
 * field.
 */
export function parsePayUri(uri: string): PayUriParams {
  const trimmed = uri.trim();
  const queryStart = trimmed.indexOf("?");
  const head = queryStart === -1 ? trimmed : trimmed.slice(0, queryStart);
  if (head.toLowerCase() !== PAY_PREFIX) {
    throw new Error("Invalid SEP-0007 pay URI: expected a web+stellar:pay URI");
  }

  const search = new URLSearchParams(queryStart === -1 ? "" : trimmed.slice(queryStart + 1));
  const get = (key: string): string | undefined => {
    const values = search.getAll(key);
    if (values.length > 1) {
      throw new Error(`Invalid SEP-0007 pay URI: duplicate "${key}" parameter`);
    }
    return values[0];
  };

  const params: PayUriParams = { destination: get("destination") ?? "" };
  const amount = get("amount");
  if (amount !== undefined) params.amount = amount;
  const assetCode = get("asset_code");
  if (assetCode !== undefined) params.assetCode = assetCode;
  const assetIssuer = get("asset_issuer");
  if (assetIssuer !== undefined) params.assetIssuer = assetIssuer;
  const memo = get("memo");
  if (memo !== undefined) params.memo = memo;
  const memoType = get("memo_type");
  if (memoType !== undefined) params.memoType = memoType as PayUriMemoType;
  const callback = get("callback");
  if (callback !== undefined) params.callback = callback;
  const msg = get("msg");
  if (msg !== undefined) params.msg = msg;
  const networkPassphrase = get("network_passphrase");
  if (networkPassphrase !== undefined) params.networkPassphrase = networkPassphrase;

  validatePayUriParams(params);
  return params;
}