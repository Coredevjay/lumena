/**
 * Signer abstracts over how a private key operation is performed.
 *
 * In development / testnet:  EnvSigner  — wraps a raw Stellar Keypair loaded
 *                                         from an environment variable.
 * In production:             AwsKmsSigner, GcpKmsSigner, VaultSigner, etc. —
 *                            the private key never leaves the HSM; only the
 *                            signature bytes are returned.
 *
 * Both CosignerService and FeeSponsorService depend on this interface so that
 * switching from env-based secrets to a KMS/HSM is a wiring change in main.ts,
 * not a service-level change.
 */
export interface Signer {
  /**
   * Returns the Ed25519 public key in Stellar's strkey format (G…).
   */
  publicKey(): string;

  /**
   * Signs the 32-byte transaction hash and returns the 64-byte signature.
   *
   * @param payload - The raw bytes to sign (typically tx.hash()).
   *                  Uses Uint8Array for cross-platform compatibility;
   *                  Node.js Buffer is a Uint8Array subtype and is accepted.
   */
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

/**
 * Configuration for {@link Signer} implementations backed by Google Cloud KMS.
 *
 * Either supply the individual components (`projectId`, `locationId`,
 * `keyRingId`, `keyId`, `keyVersion`) or the fully-qualified
 * `keyResourceName`; the latter takes precedence when both are provided.
 *
 * @example
 * ```ts
 * const config: GcpKmsSignerConfig = {
 *   projectId: 'my-project',
 *   locationId: 'global',
 *   keyRingId: 'stellar',
 *   keyId: 'cosigner',
 *   keyVersion: '1',
 * };
 * ```
 */
export interface GcpKmsSignerConfig {
  /** GCP project ID that owns the key ring. */
  projectId?: string;
  /** GCP location of the key ring, e.g. `global` or `europe-west1`. */
  locationId?: string;
  /** Name of the key ring containing the signing key. */
  keyRingId?: string;
  /** Name of the crypto key used for signing. */
  keyId?: string;
  /** Version of the crypto key, e.g. `1`. */
  keyVersion?: string;
  /** Full resource name, e.g. projects/.../locations/.../keyRings/.../cryptoKeys/.../cryptoKeyVersions/... */
  keyResourceName?: string;
  /** Optional KMS API endpoint override (useful for emulators or private endpoints). */
  endpoint?: string;
}

/**
 * Configuration for {@link Signer} implementations backed by HashiCorp Vault's
 * Transit secrets engine.
 *
 * @example
 * ```ts
 * const config: VaultSignerConfig = {
 *   vaultUrl: 'https://vault.internal:8200',
 *   token: process.env.VAULT_TOKEN!,
 *   keyName: 'stellar-cosigner',
 *   mountPath: 'transit',
 * };
 * ```
 */
export interface VaultSignerConfig {
  /** Base URL of the Vault server, e.g. `https://vault.internal:8200`. */
  vaultUrl: string;
  /** Vault authentication token with access to the transit key. */
  token: string;
  /** Name of the transit key used for signing. */
  keyName: string;
  /** Transit engine mount path. Defaults to `'transit'`. */
  mountPath?: string;
  /** Optional Vault Enterprise namespace. */
  namespace?: string;
  /** Whether the payload is already hashed before being sent to Vault. */
  prehashed?: boolean;
}

/**
 * Configuration for {@link Signer} implementations backed by a PKCS#11
 * device (HSM, SoftHSM, etc.).
 *
 * @example
 * ```ts
 * const config: Pkcs11SignerConfig = {
 *   modulePath: '/usr/lib/softhsm/libsofthsm2.so',
 *   slotId: 0,
 *   pin: process.env.PKCS11_PIN!,
 *   keyLabel: 'stellar-cosigner',
 * };
 * ```
 */
export interface Pkcs11SignerConfig {
  /** Path to the PKCS#11 provider library, e.g. /usr/lib/softhsm/libsofthsm2.so */
  modulePath: string;
  /** PKCS#11 slot ID containing the token. */
  slotId: number;
  /** PIN used to log into the token session. */
  pin: string;
  /** CKA_LABEL of the private key object to sign with. */
  keyLabel: string;
  /** Optional CKA_ID of the private key object (used when label is ambiguous). */
  keyId?: string;
  /** Optional user PIN, if distinct from the primary PIN. */
  userPin?: string;
}
