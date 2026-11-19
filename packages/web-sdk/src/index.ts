export { LumenClient, createSessionKey } from "./client.js";
export type { KeypairWalletResult, LumenClientOpts, SessionKeyInfo } from "./client.js";

/**
 * Platform-agnostic crypto adapter. Prefers Web Crypto (`crypto.subtle`) and
 * falls back to Node's `node:crypto` when Web Crypto is unavailable. Use this
 * everywhere instead of importing `node:crypto` directly so browser and React
 * Native bundles stay clean.
 */
export { crypto } from "./crypto.js";
export type { CryptoAdapter } from "./crypto.js";

/**
 * Heavy passkey / crypto helpers are intentionally NOT re-exported from the
 * base entry point. Importing them eagerly would pull the WebAuthn + crypto
 * stack into the core bundle and blow past the 45KB gzipped budget.
 *
 * Consumers that need passkey support should load them lazily:
 *
 *   const { createWalletWithPasskey, signWithPasskey } = await import("@lumen/web-sdk/passkey");
 *
 * or use the helpers below, which wrap the dynamic import so the heavy
 * dependencies are only fetched on demand.
 */

/**
 * Result of creating a wallet backed by a passkey.
 */
export interface PasskeyWalletResult {
  /** Base64url-encoded WebAuthn credential id. */
  credentialId: string;
  /** Hex-encoded public key derived from the passkey. */
  publicKey: string;
  /** Stellar address controlled by the passkey. */
  address: string;
}

/**
 * Options for registering a new passkey-backed wallet.
 */
export interface PasskeyRegistrationOpts {
  /** Human-readable user name shown by the authenticator. */
  userName: string;
  /** Optional display name shown by the authenticator. */
  displayName?: string;
}

/**
 * Options for asserting (signing) with an existing passkey.
 */
export interface PasskeyAssertionOpts {
  /** Credential id to assert with; omit to let the authenticator choose. */
  credentialId?: string;
  /** Optional challenge bytes to sign over. */
  challenge?: Uint8Array;
}

/**
 * A raw WebAuthn credential returned by the authenticator.
 */
export interface PasskeyCredential {
  /** Base64url-encoded credential id. */
  id: string;
  /** Raw credential id bytes. */
  rawId: ArrayBuffer;
  /** Credential type, e.g. `"public-key"`. */
  type: string;
}

/**
 * Lazily load the passkey module. The returned promise resolves to the
 * passkey helpers without adding them to the base bundle graph.
 *
 * @example
 * ```ts
 * const { createWalletWithPasskey } = await loadPasskeyModule();
 * const wallet = await createWalletWithPasskey({ userName: "alice" });
 * ```
 */
export async function loadPasskeyModule(): Promise<{
  /** Create a wallet backed by a new passkey. */
  createWalletWithPasskey: (opts: PasskeyRegistrationOpts) => Promise<PasskeyWalletResult>;
  /** Sign a payload with an existing passkey. */
  signWithPasskey: (opts: PasskeyAssertionOpts) => Promise<Uint8Array>;
  /** Low-level passkey manager for custom flows. */
  PasskeyManager: new () => {
    /** Register a new passkey credential. */
    register(opts: PasskeyRegistrationOpts): Promise<PasskeyCredential>;
    /** Assert with an existing passkey credential. */
    assert(opts: PasskeyAssertionOpts): Promise<PasskeyCredential>;
  };
}> {
  return import("./passkey.js");
}

/**
 * Convenience wrapper: creates a wallet backed by a passkey, loading the
 * heavy crypto dependencies only when this function is actually called.
 *
 * @param opts - Passkey registration options.
 * @returns The created wallet's credential id, public key and address.
 * @example
 * ```ts
 * const wallet = await createWalletWithPasskey({ userName: "alice" });
 * ```
 */
export async function createWalletWithPasskey(
  opts: PasskeyRegistrationOpts,
): Promise<PasskeyWalletResult> {
  const { createWalletWithPasskey: create } = await loadPasskeyModule();
  return create(opts);
}

/**
 * Convenience wrapper: signs a payload with a passkey, loading the heavy
 * crypto dependencies only when this function is actually called.
 *
 * @param opts - Passkey assertion options.
 * @returns The signature bytes.
 * @example
 * ```ts
 * const signature = await signWithPasskey({ challenge });
 * ```
 */
export async function signWithPasskey(opts: PasskeyAssertionOpts): Promise<Uint8Array> {
  const { signWithPasskey: sign } = await loadPasskeyModule();
  return sign(opts);
}