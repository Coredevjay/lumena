/**
 * Cross-platform encrypted keystore for Lumen device keys.
 *
 * Implements AES-256-GCM authenticated encryption with memory-hard key
 * derivation (Argon2id via hash-wasm, with a PBKDF2 fallback at 100,000+
 * iterations when Argon2id is unavailable). The on-disk / exported format is a
 * versioned JSON envelope compatible with Stellar ecosystem keystore
 * recommendations and the envelope shape used by `keys/manager.ts`.
 *
 * @module keys/keystore
 */

import { argon2id } from 'hash-wasm';
import {
  getCrypto,
  randomBytes as cryptoRandomBytes,
  bytesToBase64,
  base64ToBytes,
  utf8Encode,
  utf8Decode,
} from '../crypto/index.js';

/** Current keystore envelope version. */
export const KEYSTORE_VERSION = 2 as const;

/** Legacy (v1) keystore envelope version, still accepted on parse/decrypt. */
export const LEGACY_KEYSTORE_VERSION = 1 as const;

/** Supported key-derivation functions. */
export type KdfName = 'argon2id' | 'pbkdf2';

/** Supported cipher identifier. */
export type CipherName = 'aes-256-gcm';

/**
 * Explicit, tunable Argon2id cost parameters stored with the envelope.
 *
 * These are the tunable knobs referenced by the versioned keystore format:
 * `memory` (KiB), `iterations` (time cost) and `parallelism` (lanes).
 */
export interface KdfCostParams {
  /** Memory cost in kibibytes. */
  memory: number;
  /** Number of iterations (time cost). */
  iterations: number;
  /** Degree of parallelism. */
  parallelism: number;
}

/** Argon2id key-derivation parameters. */
export interface Argon2idParams extends KdfCostParams {
  /** Derived key length in bytes. */
  keyLength: number;
}

/** PBKDF2 key-derivation parameters. */
export interface Pbkdf2Params {
  /** Hash algorithm used by PBKDF2. */
  hash: 'SHA-256' | 'SHA-512';
  /** Number of iterations (must be >= 100,000). */
  iterations: number;
  /** Derived key length in bytes. */
  keyLength: number;
}

/** Union of supported KDF parameter shapes. */
export type KdfParams = Argon2idParams | Pbkdf2Params;

/** Versioned encrypted keystore envelope. */
export interface KeystoreEnvelope {
  /** Envelope format version. */
  version: typeof KEYSTORE_VERSION | typeof LEGACY_KEYSTORE_VERSION;
  /** Key-derivation function used to derive the AES key. */
  kdf: KdfName;
  /** Parameters for the selected KDF. */
  kdfParams: KdfParams;
  /** Authenticated cipher identifier. */
  cipher: CipherName;
  /** Base64-encoded public key (Stellar G... address or raw key). */
  publicKey: string;
  /** Base64-encoded random salt (16 bytes). */
  salt: string;
  /** Base64-encoded random IV / nonce (12 bytes). */
  iv: string;
  /** Base64-encoded AES-256-GCM ciphertext (includes auth tag). */
  ciphertext: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/** Options for {@link encryptKeypair}. */
export interface EncryptOptions {
  /** KDF to use. Defaults to `'argon2id'` when available, else `'pbkdf2'`. */
  kdf?: KdfName;
  /** Override Argon2id parameters. */
  argon2id?: Partial<Argon2idParams>;
  /** Override PBKDF2 parameters. */
  pbkdf2?: Partial<Pbkdf2Params>;
  /** Public key to embed in the envelope (optional). */
  publicKey?: string;
  /** Override the creation timestamp (mainly for tests). */
  createdAt?: string;
}

/** Default Argon2id parameters (OWASP-recommended baseline). */
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memory: 64 * 1024, // 64 MiB
  iterations: 3,
  parallelism: 1,
  keyLength: 32,
};

/**
 * Minimum acceptable Argon2id cost parameters. Anything below this floor is
 * rejected with a `WEAK_KDF_PARAMS` error.
 */
export const KDF_FLOOR: Readonly<KdfCostParams> = Object.freeze({
  memory: 19 * 1024, // 19 MiB (OWASP minimum)
  iterations: 2,
  parallelism: 1,
});

/**
 * Legacy (v1) Argon2id defaults. v1 envelopes stored `memoryKiB` instead of
 * `memory`; when a legacy envelope omits cost parameters entirely we fall back
 * to these documented values.
 */
export const LEGACY_ARGON2ID_PARAMS: Argon2idParams = {
  memory: 64 * 1024, // 64 MiB
  iterations: 3,
  parallelism: 1,
  keyLength: 32,
};

/** Default PBKDF2 parameters (>= 100,000 iterations). */
export const DEFAULT_PBKDF2_PARAMS: Pbkdf2Params = {
  hash: 'SHA-256',
  iterations: 210_000,
  keyLength: 32,
};

const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_PBKDF2_ITERATIONS = 100_000;

/** Error thrown for keystore-related failures. */
export class KeystoreError extends Error {
  constructor(message: string, public readonly code: KeystoreErrorCode) {
    super(message);
    this.name = 'KeystoreError';
  }
}

/** Machine-readable keystore error codes. */
export type KeystoreErrorCode =
  | 'INVALID_PASSPHRASE'
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_KDF'
  | 'UNSUPPORTED_CIPHER'
  | 'INVALID_KDF_PARAMS'
  | 'WEAK_KDF_PARAMS'
  | 'DECRYPTION_FAILED'
  | 'CRYPTO_UNAVAILABLE';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the platform crypto adapter, translating adapter failures into
 * {@link KeystoreError} so callers see a stable error surface.
 */
function getWebCrypto() {
  try {
    return getCrypto();
  } catch {
    throw new KeystoreError(
      'WebCrypto API is not available in this environment',
      'CRYPTO_UNAVAILABLE',
    );
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function randomBytes(length: number): Uint8Array {
  return cryptoRandomBytes(length);
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

let argon2Available: boolean | undefined;

async function isArgon2Available(): Promise<boolean> {
  if (argon2Available !== undefined) {
    return argon2Available;
  }
  try {
    // hash-wasm exports argon2id; verify it is callable.
    argon2Available = typeof argon2id === 'function';
  } catch {
    argon2Available = false;
  }
  return argon2Available;
}

async function deriveArgon2id(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2idParams,
): Promise<Uint8Array> {
  const result = await argon2id({
    password: passphrase,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.keyLength,
    outputType: 'binary',
  });
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

async function derivePbkdf2(
  passphrase: string,
  salt: Uint8Array,
  params: Pbkdf2Params,
): Promise<Uint8Array> {
  const crypto = getWebCrypto();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    utf8Encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: params.iterations,
      hash: params.hash,
    },
    baseKey,
    params.keyLength * 8,
  );
  return new Uint8Array(bits);
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  kdf: KdfName,
  params: KdfParams,
): Promise<Uint8Array> {
  if (kdf === 'argon2id') {
    return deriveArgon2id(passphrase, salt, params as Argon2idParams);
  }
  return derivePbkdf2(passphrase, salt, params as Pbkdf2Params);
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  const crypto = getWebCrypto();
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ---------------------------------------------------------------------------
// KDF parameter validation
// ---------------------------------------------------------------------------

/**
 * Validate Argon2id cost parameters against {@link KDF_FLOOR}.
 *
 * @param params Candidate cost parameters.
 * @throws {KeystoreError} With code `WEAK_KDF_PARAMS` when any value is below
 *         the floor, or `INVALID_KDF_PARAMS` when a value is not a positive
 *         integer.
 */
export function validateKdfParams(params: KdfCostParams): void {
  if (typeof params !== 'object' || params === null) {
    throw new KeystoreError('Missing or invalid kdf parameters', 'INVALID_KDF_PARAMS');
  }

  const { memory, iterations, parallelism } = params;

  if (
    !Number.isInteger(memory) ||
    !Number.isInteger(iterations) ||
    !Number.isInteger(parallelism) ||
    memory <= 0 ||
    iterations <= 0 ||
    parallelism <= 0
  ) {
    throw new KeystoreError('Invalid Argon2id parameters', 'INVALID_KDF_PARAMS');
  }

  if (
    memory < KDF_FLOOR.memory ||
    iterations < KDF_FLOOR.iterations ||
    parallelism < KDF_FLOOR.parallelism
  ) {
    throw new KeystoreError(
      `Argon2id parameters below floor (memory >= ${KDF_FLOOR.memory} KiB, ` +
        `iterations >= ${KDF_FLOOR.iterations}, parallelism >= ${KDF_FLOOR.parallelism})`,
      'WEAK_KDF_PARAMS',
    );
  }
}

/**
 * Normalize raw (possibly legacy) Argon2id parameters into the current shape.
 *
 * Legacy v1 envelopes stored `memoryKiB`; v2 stores `memory`. Missing cost
 * parameters fall back to {@link LEGACY_ARGON2ID_PARAMS}.
 */
function normalizeArgon2idParams(raw: Record<string, unknown>): Argon2idParams {
  const memory =
    typeof raw.memory === 'number'
      ? raw.memory
      : typeof raw.memoryKiB === 'number'
        ? raw.memoryKiB
        : LEGACY_ARGON2ID_PARAMS.memory;
  const iterations =
    typeof raw.iterations === 'number'
      ? raw.iterations
      : LEGACY_ARGON2ID_PARAMS.iterations;
  const parallelism =
    typeof raw.parallelism === 'number'
      ? raw.parallelism
      : LEGACY_ARGON2ID_PARAMS.parallelism;
  const keyLength =
    typeof raw.keyLength === 'number' ? raw.keyLength : LEGACY_ARGON2ID_PARAMS.keyLength;

  return { memory, iterations, parallelism, keyLength };
}

/** Returns true when the envelope is not already at the current version/params. */
function needsUpgrade(envelope: KeystoreEnvelope): boolean {
  if (envelope.version !== KEYSTORE_VERSION) {
    return true;
  }
  if (envelope.kdf === 'argon2id') {
    const p = envelope.kdfParams as Argon2idParams;
    return (
      p.memory < DEFAULT_ARGON2ID_PARAMS.memory ||
      p.iterations < DEFAULT_ARGON2ID_PARAMS.iterations ||
      p.parallelism < DEFAULT_ARGON2ID_PARAMS.parallelism
    );
  }
  const p = envelope.kdfParams as Pbkdf2Params;
  return p.iterations < DEFAULT_PBKDF2_PARAMS.iterations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a secret keypair with a passphrase.
 *
 * @param secret     The secret to encrypt (e.g. Stellar `S...` secret key).
 * @param passphrase User-supplied passphrase.
 * @param opts       Optional KDF / envelope overrides.
 * @returns A versioned {@link KeystoreEnvelope}.
 */
export async function encryptKeypair(
  secret: string,
  passphrase: string,
  opts: EncryptOptions = {},
): Promise<KeystoreEnvelope> {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new KeystoreError('Secret must be a non-empty string', 'INVALID_ENVELOPE');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new KeystoreError('Passphrase must be a non-empty string', 'INVALID_PASSPHRASE');
  }

  const crypto = getWebCrypto();

  let kdf: KdfName;
  if (opts.kdf) {
    kdf = opts.kdf;
  } else {
    kdf = (await isArgon2Available()) ? 'argon2id' : 'pbkdf2';
  }

  let kdfParams: KdfParams;
  if (kdf === 'argon2id') {
    if (!(await isArgon2Available())) {
      throw new KeystoreError(
        'Argon2id is not available in this environment',
        'UNSUPPORTED_KDF',
      );
    }
    const merged: Argon2idParams = { ...DEFAULT_ARGON2ID_PARAMS, ...(opts.argon2id ?? {}) };
    validateKdfParams(merged);
    kdfParams = merged;
  } else {
    const merged = { ...DEFAULT_PBKDF2_PARAMS, ...(opts.pbkdf2 ?? {}) };
    if (merged.iterations < MIN_PBKDF2_ITERATIONS) {
      throw new KeystoreError(
        `PBKDF2 iterations must be >= ${MIN_PBKDF2_ITERATIONS}`,
        'INVALID_KDF_PARAMS',
      );
    }
    kdfParams = merged;
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);

  const rawKey = await deriveKey(passphrase, salt, kdf, kdfParams);
  const aesKey = await importAesKey(rawKey);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    aesKey,
    utf8Encode(secret),
  );

  return {
    version: KEYSTORE_VERSION,
    kdf,
    kdfParams,
    cipher: 'aes-256-gcm',
    publicKey: opts.publicKey ?? '',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
}

/** Encrypts a secret as a versioned keystore envelope. */
export async function encryptKeystore(
  secret: string,
  passphrase: string,
  opts: EncryptOptions = {},
): Promise<KeystoreEnvelope> {
  return encryptKeypair(secret, passphrase, opts);
}

/**
 * Decrypt a keystore envelope with a passphrase.
 *
 * @param envelope   The keystore envelope to decrypt.
 * @param passphrase User-supplied passphrase.
 * @returns The decrypted secret string.
 * @throws {KeystoreError} On malformed envelope, unsupported version, or
 *         incorrect passphrase (AES-GCM auth-tag failure).
 */
export async function decryptKeypair(
  envelope: KeystoreEnvelope,
  passphrase: string,
): Promise<string> {
  const { secret } = await decryptKeypairWithUpgrade(envelope, passphrase);
  return secret;
}

/**
 * Decrypt a keystore envelope and, when it is an older version or uses weaker
 * than current default parameters, transparently re-encrypt it with the
 * current defaults.
 *
 * @param envelope   The keystore envelope to decrypt.
 * @param passphrase User-supplied passphrase.
 * @returns The decrypted secret and an upgraded envelope (or the original
 *          envelope when no upgrade was necessary).
 */
export async function decryptKeypairWithUpgrade(
  envelope: KeystoreEnvelope,
  passphrase: string,
): Promise<{ secret: string; envelope: KeystoreEnvelope; upgraded: boolean }> {
  validateEnvelope(envelope);

  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new KeystoreError('Passphrase must be a non-empty string', 'INVALID_PASSPHRASE');
  }

  const crypto = getWebCrypto();

  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  if (salt.length !== SALT_BYTES) {
    throw new KeystoreError('Invalid salt length', 'INVALID_ENVELOPE');
  }
  if (iv.length !== IV_BYTES) {
    throw new KeystoreError('Invalid IV length', 'INVALID_ENVELOPE');
  }

  const rawKey = await deriveKey(passphrase, salt, envelope.kdf, envelope.kdfParams);
  const aesKey = await importAesKey(rawKey);

  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      aesKey,
      ciphertext,
    );
  } catch {
    throw new KeystoreError(
      'Decryption failed: incorrect passphrase or corrupted keystore',
      'INVALID_PASSPHRASE',
    );
  }

  const secret = utf8Decode(new Uint8Array(plaintextBuf));

  if (!needsUpgrade(envelope)) {
    return { secret, envelope, upgraded: false };
  }

  const upgradedEnvelope = await encryptKeypair(secret, passphrase, {
    publicKey: envelope.publicKey,
    createdAt: envelope.createdAt,
  });

  return { secret, envelope: upgradedEnvelope, upgraded: true };
}

/**
 * Re-encrypt an existing envelope with the current default KDF parameters.
 *
 * @param envelope   The keystore envelope to upgrade.
 * @param passphrase User-supplied passphrase.
 * @returns The upgraded envelope (or the original when already current).
 */
export async function upgradeKeystore(
  envelope: KeystoreEnvelope,
  passphrase: string,
): Promise<KeystoreEnvelope> {
  const { envelope: upgraded } = await decryptKeypairWithUpgrade(envelope, passphrase);
  return upgraded;
}

/** Decrypts a versioned keystore envelope to its original secret. */
export async function decryptKeystore(
  envelope: KeystoreEnvelope,
  passphrase: string,
): Promise<string> {
  return decryptKeypair(envelope, passphrase);
}

/** Parses and validates an unknown value as a keystore envelope. */
export function parseKeystoreEnvelope(value: unknown): KeystoreEnvelope {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new KeystoreError('Keystore JSON is malformed', 'INVALID_ENVELOPE');
    }
  }
  validateEnvelope(parsed);
  return parsed;
}

/**
 * Serialize a keystore envelope to a JSON string for export.
 *
 * @param envelope The envelope to export.
 * @returns Pretty-printed JSON string.
 */
export function exportKeystore(envelope: KeystoreEnvelope): string {
  validateEnvelope(envelope);
  return JSON.stringify(envelope, null, 2);
}

/**
 * Import a keystore from a JSON string and decrypt it.
 *
 * @param json       The JSON keystore string.
 * @param passphrase User-supplied passphrase.
 * @returns The decrypted secret string.
 * @throws {KeystoreError} On malformed JSON, unsupported version, or wrong
 *         passphrase.
 */
export async function importKeystore(json: string, passphrase: string): Promise<string> {
  const { secret } = await importKeystoreWithUpgrade(json, passphrase);
  return secret;
}

/**
 * Import a keystore from a JSON string, decrypt it, and return an upgraded
 * envelope when the source was an older version or used weaker parameters.
 *
 * @param json       The JSON keystore string.
 * @param passphrase User-supplied passphrase.
 * @returns The decrypted secret and the (possibly upgraded) envelope.
 */
export async function importKeystoreWithUpgrade(
  json: string,
  passphrase: string,
): Promise<{ secret: string; envelope: KeystoreEnvelope; upgraded: boolean }> {
  if (typeof json !== 'string' || json.trim().length === 0) {
    throw new KeystoreError('Keystore JSON must be a non-empty string', 'INVALID_ENVELOPE');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new KeystoreError('Keystore JSON is malformed', 'INVALID_ENVELOPE');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new KeystoreError('Keystore JSON must be an object', 'INVALID_ENVELOPE');
  }

  const envelope = parsed as KeystoreEnvelope;
  validateEnvelope(envelope);

  return decryptKeypairWithUpgrade(envelope, passphrase);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateEnvelope(envelope: unknown): asserts envelope is KeystoreEnvelope {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new KeystoreError('Keystore envelope must be an object', 'INVALID_ENVELOPE');
  }

  const env = envelope as Record<string, unknown>;

  if (env.version !== KEYSTORE_VERSION && env.version !== LEGACY_KEYSTORE_VERSION) {
    throw new KeystoreError(
      `Unsupported keystore version: ${String(env.version)}`,
      'UNSUPPORTED_VERSION',
    );
  }

  if (env.kdf !== 'argon2id' && env.kdf !== 'pbkdf2') {
    throw new KeystoreError(
      `Unsupported KDF: ${String(env.kdf)}`,
      'UNSUPPORTED_KDF',
    );
  }

  if (env.cipher !== 'aes-256-gcm') {
    throw new KeystoreError(
      `Unsupported cipher: ${String(env.cipher)}`,
      'UNSUPPORTED_CIPHER',
    );
  }

  if (!isNonEmptyString(env.salt)) {
    throw new KeystoreError('Missing or invalid salt', 'INVALID_ENVELOPE');
  }
  if (!isNonEmptyString(env.iv)) {
    throw new KeystoreError('Missing or invalid iv', 'INVALID_ENVELOPE');
  }
  if (!isNonEmptyString(env.ciphertext)) {
    throw new KeystoreError('Missing or invalid ciphertext', 'INVALID_ENVELOPE');
  }
  if (typeof env.publicKey !== 'string') {
    throw new KeystoreError('Missing or invalid publicKey', 'INVALID_ENVELOPE');
  }
  if (!isNonEmptyString(env.createdAt)) {
    throw new KeystoreError('Missing or invalid createdAt', 'INVALID_ENVELOPE');
  }

  const params = env.kdfParams;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new KeystoreError('Missing or invalid kdfParams', 'INVALID_KDF_PARAMS');
  }

  const p = params as Record<string, unknown>;

  if (env.kdf === 'argon2id') {
    const normalized = normalizeArgon2idParams(p);
    if (normalized.keyLength !== 32) {
      throw new KeystoreError('Invalid Argon2id parameters', 'INVALID_KDF_PARAMS');
    }
    validateKdfParams(normalized);
    // Normalize legacy `memoryKiB` to `memory` in place so downstream code
    // (derivation, upgrade checks) sees a consistent shape.
    (env as unknown as KeystoreEnvelope).kdfParams = normalized;
  } else {
    if (
      (p.hash !== 'SHA-256' && p.hash !== 'SHA-512') ||
      typeof p.iterations !== 'number' ||
      p.iterations < MIN_PBKDF2_ITERATIONS ||
      typeof p.keyLength !== 'number' ||
      p.keyLength !== 32
    ) {
      throw new KeystoreError('Invalid PBKDF2 parameters', 'INVALID_KDF_PARAMS');
    }
  }
}