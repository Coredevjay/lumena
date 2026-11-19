import { Keypair } from "@stellar/stellar-sdk";
import {
  decryptKeystore,
  encryptKeystore,
  parseKeystoreEnvelope,
  type EncryptOptions,
  type KeystoreEnvelope,
} from "./keystore";
import {
  deriveKeypairFromMnemonic,
  generateMnemonic,
  validateMnemonic,
} from "./mnemonic";

export interface StoredKey {
  publicKey: string;
  encryptedSecret: string;
  createdAt: Date;
}

export type { KeystoreEnvelope };
export {
  KEYSTORE_VERSION,
  DEFAULT_ARGON2ID_PARAMS,
  KDF_FLOOR,
  validateKdfParams,
  upgradeKeystore,
  parseKeystoreEnvelope,
  encryptKeystore,
  decryptKeystore,
} from "./keystore";
export type { Argon2idParams } from "./keystore";

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

const STORAGE_PREFIX = "lumen:key-manager:";

function createMemoryStorage(): KeyStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => Array.from(values.keys())[index] ?? null,
  };
}

function getDefaultStorage(): KeyStorage {
  return typeof globalThis.localStorage === "undefined"
    ? createMemoryStorage()
    : globalThis.localStorage;
}

function parseStoredKey(value: string): StoredKey {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Stored key data is invalid");
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.publicKey !== "string" ||
    typeof candidate.encryptedSecret !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    throw new Error("Stored key data is invalid");
  }

  const createdAt = new Date(candidate.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("Stored key creation date is invalid");
  }

  return {
    publicKey: candidate.publicKey,
    encryptedSecret: candidate.encryptedSecret,
    createdAt,
  };
}

/**
 * Manages Stellar keypairs and their encrypted keystore envelopes.
 *
 * Secret material is held in `Uint8Array` buffers and overwritten with zeros
 * as soon as it is no longer needed. Note that JavaScript cannot guarantee
 * memory zeroisation: the garbage collector may copy buffers, strings are
 * interned and immutable, and the runtime may retain copies in registers or
 * caches. Zeroisation here is therefore best-effort and only narrows the
 * exposure window; it does not eliminate it. Call {@link KeyManager.dispose}
 * when the manager is no longer needed to zeroise any retained buffers.
 */
export class KeyManager {
  private readonly storage: KeyStorage;
  private readonly retainedBuffers = new Set<Uint8Array>();
  private disposed = false;

  constructor(storage: KeyStorage = getDefaultStorage()) {
    this.storage = storage;
  }

  /**
   * Best-effort zeroisation: fills the buffer with zeros. JavaScript cannot
   * guarantee that no copies of the data remain in memory.
   */
  private zeroise(buffer: Uint8Array): void {
    buffer.fill(0);
    this.retainedBuffers.delete(buffer);
  }

  /**
   * Best-effort disposal: zeroises any buffers retained by this manager and
   * marks it unusable. Subsequent operations throw. Because JavaScript cannot
   * guarantee memory zeroisation, this does not guarantee secrets are erased
   * from memory.
   */
  dispose(): void {
    for (const buffer of this.retainedBuffers) {
      buffer.fill(0);
    }
    this.retainedBuffers.clear();
    this.disposed = true;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("KeyManager has been disposed");
    }
  }

  private trackSecret(secret: string): Uint8Array {
    const buffer = new TextEncoder().encode(secret);
    this.retainedBuffers.add(buffer);
    return buffer;
  }

  generateKeypair(): Keypair {
    return Keypair.random();
  }

  /**
   * Generates a new BIP-39 mnemonic phrase and derives the default Stellar
   * keypair (SEP-0005 account index 0) from it.
   */
  createFromMnemonic(strength: 128 | 256 = 128): {
    mnemonic: string;
    keypair: Keypair;
  } {
    const mnemonic = generateMnemonic(strength);
    const keypair = deriveKeypairFromMnemonic(mnemonic);
    return { mnemonic, keypair };
  }

  /**
   * Recovers a Stellar keypair from an existing BIP-39 mnemonic phrase using
   * SEP-0005 derivation.
   */
  recoverFromMnemonic(
    mnemonic: string,
    passphrase?: string,
    accountIndex?: number,
  ): Keypair {
    if (!validateMnemonic(mnemonic)) {
      throw new Error("Invalid mnemonic phrase");
    }
    return deriveKeypairFromMnemonic(mnemonic, passphrase, accountIndex);
  }

  async deriveFromOAuth(provider: string, token: string, salt?: string): Promise<Keypair> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(token),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const data = encoder.encode(`${provider}:${salt ?? "lumen-derivation"}`);
    const signature = await crypto.subtle.sign("HMAC", keyMaterial, data);
    const seed = Buffer.from(new Uint8Array(signature).slice(0, 32));

    return Keypair.fromRawEd25519Seed(seed);
  }

  async store(
    key: Keypair,
    passphrase: string,
    options?: EncryptOptions,
  ): Promise<StoredKey> {
    this.assertUsable();
    const secretBuffer = this.trackSecret(key.secret());
    try {
      const envelope = await encryptKeystore(
        new TextDecoder().decode(secretBuffer),
        passphrase,
        {
          ...options,
          publicKey: key.publicKey(),
        },
      );

      const stored: StoredKey = {
        publicKey: envelope.publicKey,
        encryptedSecret: JSON.stringify(envelope),
        createdAt: new Date(envelope.createdAt),
      };
      this.storage.setItem(
        `${STORAGE_PREFIX}${stored.publicKey}`,
        JSON.stringify(stored),
      );
      return stored;
    } finally {
      this.zeroise(secretBuffer);
    }
  }

  /**
   * Exports a stored key as a versioned AES-256-GCM keystore envelope that can
   * be written to disk and imported on another machine.
   */
  async export(publicKey: string, passphrase: string): Promise<KeystoreEnvelope> {
    this.assertUsable();
    const storedValue = this.storage.getItem(`${STORAGE_PREFIX}${publicKey}`);
    if (storedValue === null) throw new Error(`Key not found: ${publicKey}`);
    const stored = parseStoredKey(storedValue);
    const envelope = parseKeystoreEnvelope(stored.encryptedSecret);
    const secret = await decryptKeystore(envelope, passphrase);
    const secretBuffer = this.trackSecret(secret);
    try {
      return envelope;
    } finally {
      this.zeroise(secretBuffer);
    }
  }

  /**
   * Imports a versioned keystore envelope, decrypting it and persisting the
   * resulting key in local storage.
   */
  async import(envelope: KeystoreEnvelope | string, passphrase: string): Promise<StoredKey> {
    this.assertUsable();
    const parsedEnvelope = parseKeystoreEnvelope(envelope);
    const secret = await decryptKeystore(parsedEnvelope, passphrase);
    const secretBuffer = this.trackSecret(secret);
    try {
      const keypair = Keypair.fromSecret(new TextDecoder().decode(secretBuffer));
      if (keypair.publicKey() !== parsedEnvelope.publicKey) {
        throw new Error("Keystore public key does not match its secret");
      }
      const storedKey: StoredKey = {
        publicKey: keypair.publicKey(),
        encryptedSecret: JSON.stringify(parsedEnvelope),
        createdAt: new Date(parsedEnvelope.createdAt),
      };
      this.storage.setItem(
        `${STORAGE_PREFIX}${storedKey.publicKey}`,
        JSON.stringify(storedKey),
      );
      return storedKey;
    } finally {
      this.zeroise(secretBuffer);
    }
  }

  async load(publicKey: string, passphrase: string): Promise<Keypair> {
    this.assertUsable();
    const storedValue = this.storage.getItem(`${STORAGE_PREFIX}${publicKey}`);
    if (storedValue === null) throw new Error(`Key not found: ${publicKey}`);
    const stored = parseStoredKey(storedValue);

    const envelope = parseKeystoreEnvelope(stored.encryptedSecret);
    const secret = await decryptKeystore(envelope, passphrase);
    const secretBuffer = this.trackSecret(secret);
    try {
      const keypair = Keypair.fromSecret(new TextDecoder().decode(secretBuffer));
      if (keypair.publicKey() !== publicKey) {
        throw new Error("Stored key public key does not match its secret");
      }
      return keypair;
    } finally {
      this.zeroise(secretBuffer);
    }
  }

  async exportKeystore(
    keypair: Keypair,
    passphrase: string,
    options?: EncryptOptions,
  ): Promise<KeystoreEnvelope> {
    this.assertUsable();
    const secretBuffer = this.trackSecret(keypair.secret());
    try {
      return await encryptKeystore(
        new TextDecoder().decode(secretBuffer),
        passphrase,
        {
          ...options,
          publicKey: keypair.publicKey(),
        },
      );
    } finally {
      this.zeroise(secretBuffer);
    }
  }

  async importKeystore(
    envelope: KeystoreEnvelope | string,
    passphrase: string,
  ): Promise<Keypair> {
    this.assertUsable();
    const parsedEnvelope = parseKeystoreEnvelope(envelope);
    const secret = await decryptKeystore(parsedEnvelope, passphrase);
    const secretBuffer = this.trackSecret(secret);
    try {
      const keypair = Keypair.fromSecret(new TextDecoder().decode(secretBuffer));
      if (keypair.publicKey() !== parsedEnvelope.publicKey) {
        throw new Error("Keystore public key does not match its secret");
      }
      return keypair;
    } finally {
      this.zeroise(secretBuffer);
    }
  }

  list(): StoredKey[] {
    this.assertUsable();
    const storedKeys: StoredKey[] = [];
    for (let index = 0; index < this.storage.length; index++) {
      const storageKey = this.storage.key(index);
      if (storageKey?.startsWith(STORAGE_PREFIX)) {
        const value = this.storage.getItem(storageKey);
        if (value !== null) {
          storedKeys.push(parseStoredKey(value));
        }
      }
    }
    return storedKeys;
  }

  delete(publicKey: string): boolean {
    this.assertUsable();
    const storageKey = `${STORAGE_PREFIX}${publicKey}`;
    if (this.storage.getItem(storageKey) === null) {
      return false;
    }
    this.storage.removeItem(storageKey);
    return true;
  }
}
