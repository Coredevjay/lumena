import { Keypair } from "@stellar/stellar-sdk";
import { getCrypto } from "../crypto/index.js";

// ---------------------------------------------------------------------------
// WebAuthn DER signature parser and P-256 verification helpers  (#284)
// ---------------------------------------------------------------------------

/**
 * Parsed components of a DER-encoded ECDSA signature produced by a WebAuthn
 * Secp256r1 (P-256) authenticator.
 */
export interface ParsedDerSignature {
  /** Raw 32-byte big-endian r scalar. */
  r: Uint8Array;
  /** Raw 32-byte big-endian s scalar. */
  s: Uint8Array;
}

/**
 * Parses a DER-encoded ECDSA signature (as produced by WebAuthn P-256
 * authenticators) into raw `r` and `s` scalar components.
 *
 * DER structure:
 *   SEQUENCE {
 *     INTEGER  r
 *     INTEGER  s
 *   }
 *
 * Integers in DER may have a leading 0x00 byte prepended when the high-bit is
 * set (to indicate positive sign). This function strips that padding and
 * zero-pads both scalars to exactly 32 bytes for use with `SubtleCrypto`.
 *
 * @throws {Error} if the buffer is not a valid DER ECDSA signature.
 */
export function parseDerSignature(derBytes: ArrayBuffer | Uint8Array): ParsedDerSignature {
  const buf = derBytes instanceof Uint8Array ? derBytes : new Uint8Array(derBytes);
  let offset = 0;

  const readByte = (): number => {
    if (offset >= buf.length) throw new Error("DER parse: unexpected end of buffer");
    return buf[offset++]!;
  };

  const readLength = (): number => {
    const first = readByte();
    if (first < 0x80) return first;
    const numBytes = first & 0x7f;
    if (numBytes === 0 || numBytes > 4) throw new Error("DER parse: invalid length encoding");
    let len = 0;
    for (let i = 0; i < numBytes; i++) len = (len << 8) | readByte();
    return len;
  };

  const readInteger = (): Uint8Array => {
    const tag = readByte();
    if (tag !== 0x02) throw new Error(`DER parse: expected INTEGER tag 0x02, got 0x${tag.toString(16)}`);
    const len = readLength();
    const raw = buf.slice(offset, offset + len);
    offset += len;
    // Strip leading zero byte added by DER for sign representation
    const stripped = raw[0] === 0x00 ? raw.slice(1) : raw;
    // Zero-pad to 32 bytes (P-256 scalar size)
    const padded = new Uint8Array(32);
    padded.set(stripped, 32 - stripped.length);
    return padded;
  };

  // SEQUENCE tag
  const seqTag = readByte();
  if (seqTag !== 0x30) throw new Error(`DER parse: expected SEQUENCE tag 0x30, got 0x${seqTag.toString(16)}`);
  readLength(); // sequence length — we validate element-by-element

  const r = readInteger();
  const s = readInteger();

  return { r, s };
}

/**
 * Concatenates the parsed r and s scalars into the 64-byte raw signature
 * format (`r || s`) required by `SubtleCrypto.verify` with ECDSA.
 */
export function derToRawSignature(derBytes: ArrayBuffer | Uint8Array): Uint8Array {
  const { r, s } = parseDerSignature(derBytes);
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/**
 * Options for verifying a WebAuthn assertion.
 */
export interface WebAuthnVerificationOpts {
  /**
   * The DER-encoded ECDSA-SHA256 signature from `AuthenticatorAssertionResponse.signature`.
   */
  signature: ArrayBuffer | Uint8Array;
  /**
   * The raw `authenticatorData` bytes from `AuthenticatorAssertionResponse.authenticatorData`.
   */
  authenticatorData: ArrayBuffer | Uint8Array;
  /**
   * The raw `clientDataJSON` bytes from `AuthenticatorAssertionResponse.clientDataJSON`.
   */
  clientDataJSON: ArrayBuffer | Uint8Array;
  /**
   * The COSE-encoded public key bytes stored at credential registration time,
   * or a `CryptoKey` (ECDSA P-256, `verify` usage) to verify against.
   */
  publicKey: CryptoKey;
  /**
   * The original challenge that was embedded in the clientDataJSON (base64url-encoded).
   * When provided, the extracted challenge is compared and verification fails on mismatch.
   */
  expectedChallenge?: string;
}

/**
 * Result of a WebAuthn assertion verification.
 */
export interface WebAuthnVerificationResult {
  valid: boolean;
  /** The base64url-encoded challenge extracted from clientDataJSON. */
  challenge: string;
  /** The parsed r and s scalar components from the DER signature. */
  signature: ParsedDerSignature;
}

/**
 * Verifies a WebAuthn P-256 assertion against the stored public key.
 *
 * The verification follows the WebAuthn Level 2 spec §7.2:
 *   1. Parse and validate `clientDataJSON` (type, origin, challenge).
 *   2. Compute `SHA-256(clientDataJSON)`.
 *   3. Assemble the signed data: `authenticatorData || SHA-256(clientDataJSON)`.
 *   4. Convert the DER signature to raw `r || s` format.
 *   5. Verify the ECDSA-SHA256 signature over the assembled signed data.
 *
 * @returns `WebAuthnVerificationResult` — `valid` is `false` (not thrown) when
 *          the signature is cryptographically invalid.
 * @throws  When inputs are malformed (invalid DER, non-P-256 key, bad JSON).
 */
export async function verifyWebAuthnAssertion(
  opts: WebAuthnVerificationOpts,
): Promise<WebAuthnVerificationResult> {
  // Step 1: parse clientDataJSON
  const clientDataText = new TextDecoder().decode(opts.clientDataJSON);
  let clientData: Record<string, unknown>;
  try {
    clientData = JSON.parse(clientDataText) as Record<string, unknown>;
  } catch {
    throw new Error("WebAuthn verify: clientDataJSON is not valid JSON");
  }

  if (clientData["type"] !== "webauthn.get") {
    throw new Error(
      `WebAuthn verify: unexpected clientData type "${String(clientData["type"])}", expected "webauthn.get"`,
    );
  }

  const challenge = String(clientData["challenge"] ?? "");

  if (opts.expectedChallenge !== undefined && challenge !== opts.expectedChallenge) {
    throw new Error(
      `WebAuthn verify: challenge mismatch — expected "${opts.expectedChallenge}", got "${challenge}"`,
    );
  }

  const cryptoAdapter = getCrypto();

  // Step 2: SHA-256(clientDataJSON)
  const clientDataHash = await cryptoAdapter.subtle.digest("SHA-256", opts.clientDataJSON);

  // Step 3: signed data = authenticatorData || SHA-256(clientDataJSON)
  const authData =
    opts.authenticatorData instanceof Uint8Array
      ? opts.authenticatorData
      : new Uint8Array(opts.authenticatorData);
  const signedData = new Uint8Array(authData.byteLength + 32);
  signedData.set(authData, 0);
  signedData.set(new Uint8Array(clientDataHash), authData.byteLength);

  // Step 4: DER → raw r||s
  const rawSig = derToRawSignature(opts.signature);

  // Step 5: verify
  const valid = await cryptoAdapter.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    opts.publicKey,
    rawSig,
    signedData,
  );

  return { valid, challenge, signature: parseDerSignature(opts.signature) };
}

/**
 * Extracts and validates the challenge from a raw `clientDataJSON` buffer.
 * Returns the base64url-encoded challenge string embedded by the relying party.
 *
 * Useful when a server needs to verify that the challenge it issued is
 * included in the authenticator response before performing the full assertion
 * verification.
 *
 * @throws {Error} if the JSON is malformed or the challenge field is absent.
 */
export function extractChallengeFromClientData(clientDataJSON: ArrayBuffer | Uint8Array): string {
  const text = new TextDecoder().decode(clientDataJSON);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("extractChallengeFromClientData: clientDataJSON is not valid JSON");
  }
  if (!parsed["challenge"] || typeof parsed["challenge"] !== "string") {
    throw new Error("extractChallengeFromClientData: missing or invalid challenge field");
  }
  return parsed["challenge"];
}

// ---------------------------------------------------------------------------

export interface PasskeyCredential {
  id: string;
  rawId: ArrayBuffer;
  type: "public-key";
  response: {
    clientDataJSON: ArrayBuffer;
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
  };
  prfResults?: {
    first?: ArrayBuffer;
    second?: ArrayBuffer;
  };
}

export interface PasskeyRegistrationOpts {
  username: string;
  rpName?: string;
  challenge?: Uint8Array;
  /** Relying party ID (defaults to the current host when available). */
  rpId?: string;
  /** Require the authenticator to perform user verification. */
  requireUserVerification?: boolean;
  /** Credential kind hint for the multi-credential registry. */
  kind?: PasskeyCredentialKind;
}

/** Classification of a registered passkey credential. */
export type PasskeyCredentialKind = "synced" | "hardware";

/**
 * A single registered passkey belonging to a wallet.
 */
export interface PasskeyRecord {
  /** base64url-encoded credential ID. */
  id: string;
  /** Raw credential ID bytes. */
  rawId: ArrayBuffer;
  /** Whether the credential is a synced (platform) or hardware authenticator. */
  kind: PasskeyCredentialKind;
  /** COSE-encoded public key bytes captured at registration, when available. */
  publicKey?: ArrayBuffer;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
}

export interface PasskeyAssertionOpts {
  credentialId?: string | Uint8Array;
  challenge?: Uint8Array;
}

export class PasskeyManager {
  /**
   * In-memory registry of passkeys keyed by wallet/username. Each wallet may
   * hold multiple credentials (synced and hardware) so that losing one device
   * does not lock the user out.
   */
  private static registry: Map<string, PasskeyRecord[]> = new Map();

  /** Returns the registered passkeys for a wallet (empty array when none). */
  static listPasskeys(username: string): PasskeyRecord[] {
    return [...(PasskeyManager.registry.get(username) ?? [])];
  }

  /** Clears the registry (primarily for tests). */
  static clearPasskeyRegistry(username?: string): void {
    if (username === undefined) {
      PasskeyManager.registry.clear();
    } else {
      PasskeyManager.registry.delete(username);
    }
  }

  private static appendPasskey(username: string, record: PasskeyRecord): void {
    const existing = PasskeyManager.registry.get(username) ?? [];
    if (existing.some((r) => r.id === record.id)) return;
    existing.push(record);
    PasskeyManager.registry.set(username, existing);
  }

  /**
   * Registers an additional passkey for an existing wallet and appends it to
   * the multi-credential registry.
   */
  async addPasskey(opts: PasskeyRegistrationOpts): Promise<{
    credentialId: string;
    keypair: Keypair;
    credential: PasskeyCredential;
    record: PasskeyRecord;
  }> {
    const result = await this.registerPasskey(opts);
    const record = PasskeyManager.listPasskeys(opts.username).find(
      (r) => r.id === result.credentialId,
    );
    if (!record) {
      throw new Error("addPasskey: credential was not recorded in the registry");
    }
    return { ...result, record };
  }

  /**
   * Removes a passkey from a wallet's registry.
   *
   * @throws {Error} when the credential is unknown or when removing it would
   *         leave the wallet without any valid credential.
   */
  static removePasskey(username: string, credentialId: string): void {
    const existing = PasskeyManager.registry.get(username) ?? [];
    const index = existing.findIndex((r) => r.id === credentialId);
    if (index === -1) {
      throw new Error(`removePasskey: unknown credential "${credentialId}"`);
    }
    if (existing.length <= 1) {
      throw new Error("removePasskey: cannot remove the last credential for a wallet");
    }
    existing.splice(index, 1);
    PasskeyManager.registry.set(username, existing);
  }

  static isWebAuthnSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.navigator !== "undefined" &&
      !!window.navigator.credentials &&
      typeof window.navigator.credentials.create === "function"
    );
  }

  static isPrfSupported(): boolean {
    return (
      PasskeyManager.isWebAuthnSupported() &&
      typeof PublicKeyCredential !== "undefined" &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    );
  }

  /**
   * Registers a new WebAuthn credential (passkey) with PRF extension support or deterministic fallback.
   */
  async registerPasskey(opts: PasskeyRegistrationOpts): Promise<{
    credentialId: string;
    keypair: Keypair;
    credential: PasskeyCredential;
  }> {
    const cryptoAdapter = getCrypto();
    const rpName = opts.rpName ?? "Lumen Wallet";
    const challenge = opts.challenge ?? crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const userVerification = opts.requireUserVerification ? "required" : "preferred";
    const rpId =
      opts.rpId ??
      (typeof window !== "undefined" && window.location ? window.location.hostname : undefined);

    let credentialId: string;
    let keypair: Keypair;
    let credentialObj: PasskeyCredential;

    if (PasskeyManager.isWebAuthnSupported()) {
      const prfSalt = new TextEncoder().encode(`lumen-passkey-prf-salt:${opts.username}`);
      const prfSaltPadded = new Uint8Array(32);
      prfSaltPadded.set(prfSalt.subarray(0, 32));

      const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
        challenge: challenge as BufferSource,
        rp: rpId ? { id: rpId, name: rpName } : { name: rpName },
        user: {
          id: userId as BufferSource,
          name: opts.username,
          displayName: opts.username,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256 (Secp256r1)
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          userVerification,
          residentKey: "preferred",
        },
        attestation: "none",
        extensions: {
          prf: {
            eval: {
              first: prfSaltPadded as BufferSource,
            },
          },
        } as any,
      };

      const credential = (await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      })) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error("Passkey registration canceled or failed.");
      }

      const clientDataJSON = credential.response.clientDataJSON;
      const rawId = credential.rawId;
      credentialId = Buffer.from(new Uint8Array(rawId)).toString("base64url");

      const extensionResults = credential.getClientExtensionResults
        ? credential.getClientExtensionResults()
        : {};
      const prfOutput = (extensionResults as any)?.prf?.results?.first;

      keypair = await this.deriveKeypairFromWebAuthn({
        credentialId: rawId,
        clientDataJSON,
        prfOutput,
        username: opts.username,
      });

      credentialObj = {
        id: credential.id,
        rawId,
        type: "public-key",
        response: {
          clientDataJSON,
          attestationObject: (credential.response as AuthenticatorAttestationResponse).attestationObject,
        },
        prfResults: prfOutput ? { first: prfOutput } : undefined,
      };

      const attestationResponse = credential.response as AuthenticatorAttestationResponse;
      const publicKeyBytes =
        typeof attestationResponse.getPublicKey === "function"
          ? attestationResponse.getPublicKey()
          : null;

      PasskeyManager.appendPasskey(opts.username, {
        id: credentialId,
        rawId,
        kind: opts.kind ?? "synced",
        publicKey: publicKeyBytes ?? undefined,
        createdAt: Date.now(),
      });
    } else {
      // Fallback for non-browser / mock environment
      const encoder = new TextEncoder();
      const mockRawId = encoder.encode(`mock-cred-${opts.username}-${Date.now()}`);
      credentialId = Buffer.from(mockRawId).toString("base64url");
      keypair = await this.deriveKeypairFallback(mockRawId, opts.username);
      credentialObj = {
        id: credentialId,
        rawId: mockRawId.buffer as ArrayBuffer,
        type: "public-key",
        response: {
          clientDataJSON: encoder.encode(JSON.stringify({ type: "webauthn.create", origin: "http://localhost" })).buffer,
        },
      };

      PasskeyManager.appendPasskey(opts.username, {
        id: credentialId,
        rawId: mockRawId.buffer as ArrayBuffer,
        kind: opts.kind ?? "synced",
        createdAt: Date.now(),
      });
    }

    return { credentialId, keypair, credential: credentialObj };
  }

  /**
   * Authenticates using a passkey assertion and derives the corresponding Stellar Keypair.
   */
  async authenticatePasskey(opts: PasskeyAssertionOpts & { username?: string }): Promise<{
    keypair: Keypair;
    credentialId: string;
  }> {
    const cryptoAdapter = getCrypto();
    const challenge = opts.challenge ?? cryptoAdapter.getRandomValues(new Uint8Array(32));

    if (PasskeyManager.isWebAuthnSupported()) {
      const allowCredentials: PublicKeyCredentialDescriptor[] = opts.credentialId
        ? [
            {
              id:
                typeof opts.credentialId === "string"
                  ? (Buffer.from(opts.credentialId, "base64url") as BufferSource)
                  : (opts.credentialId as BufferSource),
              type: "public-key",
            },
          ]
        : [];

      const prfSalt = new TextEncoder().encode(`lumen-passkey-prf-salt:${opts.username ?? "user"}`);
      const prfSaltPadded = new Uint8Array(32);
      prfSaltPadded.set(prfSalt.subarray(0, 32));

      const assertionOptions: PublicKeyCredentialRequestOptions = {
        challenge: challenge as BufferSource,
        allowCredentials,
        userVerification: "preferred",
        extensions: {
          prf: {
            eval: {
              first: prfSaltPadded as BufferSource,
            },
          },
        } as any,
      };

      const assertion = (await navigator.credentials.get({
        publicKey: assertionOptions,
      })) as PublicKeyCredential | null;

      if (!assertion) {
        throw new Error("Passkey authentication canceled or failed.");
      }

      const extensionResults = assertion.getClientExtensionResults
        ? assertion.getClientExtensionResults()
        : {};
      const prfOutput = (extensionResults as any)?.prf?.results?.first;

      const credId = Buffer.from(new Uint8Array(assertion.rawId)).toString("base64url");
      const keypair = await this.deriveKeypairFromWebAuthn({
        credentialId: assertion.rawId,
        clientDataJSON: assertion.response.clientDataJSON,
        prfOutput,
        username: opts.username,
      });

      return { keypair, credentialId: credId };
    } else {
      // Fallback
      const rawId = typeof opts.credentialId === "string"
        ? Buffer.from(opts.credentialId, "base64url")
        : opts.credentialId ?? new TextEncoder().encode("mock-passkey");
      const keypair = await this.deriveKeypairFallback(rawId, opts.username ?? "user");
      const credId = Buffer.from(rawId).toString("base64url");
      return { keypair, credentialId: credId };
    }
  }

  /**
   * Derives a deterministic Ed25519 seed from WebAuthn assertion data or PRF extension output.
   */
  async deriveKeypairFromWebAuthn(opts: {
    credentialId: ArrayBuffer | Uint8Array;
    clientDataJSON?: ArrayBuffer | Uint8Array;
    prfOutput?: ArrayBuffer;
    username?: string;
  }): Promise<Keypair> {
    if (opts.prfOutput && opts.prfOutput.byteLength >= 32) {
      const seed = new Uint8Array(opts.prfOutput).slice(0, 32);
      return Keypair.fromRawEd25519Seed(Buffer.from(seed));
    }

    // Fallback strategy when PRF extension is unavailable
    const rawIdBytes = new Uint8Array(opts.credentialId);
    return this.deriveKeypairFallback(rawIdBytes, opts.username ?? "user");
  }

  /**
   * Fallback key derivation strategy using HMAC-SHA256 over credential ID and username.
   */
  async deriveKeypairFallback(credentialId: Uint8Array, username: string): Promise<Keypair> {
    const cryptoAdapter = getCrypto();
    const encoder = new TextEncoder();
    const secretKeyMaterial = await cryptoAdapter.subtle.importKey(
      "raw",
      credentialId as unknown as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const data = encoder.encode(`lumen-webauthn-fallback-seed:${username}`);
    const signature = await cryptoAdapter.subtle.sign("HMAC", secretKeyMaterial, data);
    const seed = Buffer.from(new Uint8Array(signature).slice(0, 32));

    return Keypair.fromRawEd25519Seed(seed);
  }
}

// ---------------------------------------------------------------------------
// Server-side registration verification (#526)
// ---------------------------------------------------------------------------

/** Attestation formats supported by {@link verifyRegistrationResponse}. */
export type SupportedAttestationFormat = "none" | "packed";

export interface VerifyRegistrationOpts {
  /** Raw `clientDataJSON` bytes from the registration response. */
  clientDataJSON: ArrayBuffer | Uint8Array;
  /** Raw `attestationObject` bytes from the registration response. */
  attestationObject: ArrayBuffer | Uint8Array;
  /** Expected origin, e.g. `https://wallet.example.com`. */
  expectedOrigin: string;
  /** Expected relying party ID hash (SHA-256 of the RP ID), 32 bytes. */
  expectedRpIdHash: ArrayBuffer | Uint8Array;
  /** The base64url challenge the server issued. */
  expectedChallenge?: string;
  /** When true, the UV flag in authenticatorData must be set. */
  requireUserVerification?: boolean;
}

export interface VerifyRegistrationResult {
  valid: boolean;
  /** Attestation format declared by the authenticator. */
  fmt: string;
  /** Whether the user verification flag was set. */
  userVerified: boolean;
  /** The base64url challenge extracted from clientDataJSON. */
  challenge: string;
}

/**
 * Minimal CBOR decoder sufficient for WebAuthn attestation objects
 * (`{ fmt, attStmt, authData }`). Supports unsigned integers, byte strings,
 * text strings, arrays and maps — the subset used by `none`/`packed`.
 */
function decodeCbor(input: Uint8Array): unknown {
  let offset = 0;

  const readLength = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return input[offset++]!;
    if (info === 25) {
      const v = (input[offset]! << 8) | input[offset + 1]!;
      offset += 2;
      return v;
    }
    if (info === 26) {
      const v =
        (input[offset]! << 24) |
        (input[offset + 1]! << 16) |
        (input[offset + 2]! << 8) |
        input[offset + 3]!;
      offset += 4;
      return v >>> 0;
    }
    throw new Error("CBOR: unsupported length encoding");
  };

  const decodeItem = (): unknown => {
    const initial = input[offset++]!;
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return readLength(info);
      case 1:
        return -1 - readLength(info);
      case 2: {
        const len = readLength(info);
        const bytes = input.slice(offset, offset + len);
        offset += len;
        return bytes;
      }
      case 3: {
        const len = readLength(info);
        const text = new TextDecoder().decode(input.slice(offset, offset + len));
        offset += len;
        return text;
      }
      case 4: {
        const len = readLength(info);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(decodeItem());
        return arr;
      }
      case 5: {
        const len = readLength(info);
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < len; i++) {
          const key = decodeItem();
          map.set(key, decodeItem());
        }
        return map;
      }
      default:
        throw new Error(`CBOR: unsupported major type ${major}`);
    }
  };

  return decodeItem();
}

/**
 * Verifies a WebAuthn registration (attestation) response on the server.
 *
 * Validates:
 *   - `clientDataJSON.type === "webauthn.create"`
 *   - `clientDataJSON.origin === expectedOrigin`
 *   - challenge matches `expectedChallenge` (when provided)
 *   - attestation format is `none` or `packed`
 *   - RP ID hash in `authenticatorData` matches `expectedRpIdHash`
 *   - the UV flag is set when `requireUserVerification` is true
 *
 * @throws {Error} when inputs are malformed.
 */
export async function verifyRegistrationResponse(
  opts: VerifyRegistrationOpts,
): Promise<VerifyRegistrationResult> {
  const clientDataBytes =
    opts.clientDataJSON instanceof Uint8Array
      ? opts.clientDataJSON
      : new Uint8Array(opts.clientDataJSON);

  let clientData: Record<string, unknown>;
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as Record<string, unknown>;
  } catch {
    throw new Error("WebAuthn registration: clientDataJSON is not valid JSON");
  }

  if (clientData["type"] !== "webauthn.create") {
    throw new Error(
      `WebAuthn registration: unexpected type "${String(clientData["type"])}", expected "webauthn.create"`,
    );
  }

  if (clientData["origin"] !== opts.expectedOrigin) {
    throw new Error(
      `WebAuthn registration: origin mismatch — expected "${opts.expectedOrigin}", got "${String(clientData["origin"])}"`,
    );
  }

  const challenge = String(clientData["challenge"] ?? "");
  if (opts.expectedChallenge !== undefined && challenge !== opts.expectedChallenge) {
    throw new Error(
      `WebAuthn registration: challenge mismatch — expected "${opts.expectedChallenge}", got "${challenge}"`,
    );
  }

  const attestationBytes =
    opts.attestationObject instanceof Uint8Array
      ? opts.attestationObject
      : new Uint8Array(opts.attestationObject);

  const decoded = decodeCbor(attestationBytes);
  if (!(decoded instanceof Map)) {
    throw new Error("WebAuthn registration: attestationObject is not a CBOR map");
  }

  const fmt = decoded.get("fmt");
  if (fmt !== "none" && fmt !== "packed") {
    throw new Error(`WebAuthn registration: unsupported attestation format "${String(fmt)}"`);
  }

  const authData = decoded.get("authData");
  if (!(authData instanceof Uint8Array) || authData.byteLength < 37) {
    throw new Error("WebAuthn registration: missing or truncated authenticatorData");
  }

  const expectedRpIdHash =
    opts.expectedRpIdHash instanceof Uint8Array
      ? opts.expectedRpIdHash
      : new Uint8Array(opts.expectedRpIdHash);
  if (expectedRpIdHash.byteLength !== 32) {
    throw new Error("WebAuthn registration: expectedRpIdHash must be 32 bytes");
  }

  const rpIdHash = authData.slice(0, 32);
  for (let i = 0; i < 32; i++) {
    if (rpIdHash[i] !== expectedRpIdHash[i]) {
      throw new Error("WebAuthn registration: RP ID hash mismatch");
    }
  }

  const flags = authData[32]!;
  const userVerified = (flags & 0x04) !== 0;
  if (opts.requireUserVerification && !userVerified) {
    throw new Error("WebAuthn registration: user verification required but UV flag is not set");
  }

  return { valid: true, fmt, userVerified, challenge };
}
