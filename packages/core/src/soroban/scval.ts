import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { ScValType, ScValInput } from "@lumen/types";

/** Inclusive numeric bounds for the integer ScVal builders. */
const I32_MIN = -(2n ** 31n);
const I32_MAX = 2n ** 31n - 1n;
const U32_MAX = 2n ** 32n - 1n;
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const U64_MAX = 2n ** 64n - 1n;
const I128_MIN = -(2n ** 127n);
const I128_MAX = 2n ** 127n - 1n;
const U128_MAX = 2n ** 128n - 1n;

/** Maximum length of a Soroban symbol. */
const SYMBOL_MAX_LENGTH = 32;

function toBigIntStrict(value: unknown, label: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`${label} must be an integer, got ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new Error(`${label} must be an integer string, got "${value}"`);
    }
    return BigInt(trimmed);
  }
  throw new Error(`${label} must be a bigint, integer number or integer string`);
}

function assertRange(value: bigint, min: bigint, max: bigint, label: string): bigint {
  if (value < min || value > max) {
    throw new Error(`${label} out of range: ${value} (expected ${min}..${max})`);
  }
  return value;
}

function toBufferStrict(value: unknown, label: string): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error(`${label} must be a valid hex string, got "${value}"`);
    }
    return Buffer.from(hex, "hex");
  }
  throw new Error(`${label} must be a Buffer, Uint8Array or hex string`);
}

/**
 * Typed, validated builders for Soroban `xdr.ScVal` values.
 *
 * Each builder returns an `xdr.ScVal` and throws a descriptive error when the
 * input is invalid, so callers no longer construct ScVals by hand.
 */
export const sc = {
  /** Builds an `scvAddress` from a Stellar account (G...) or contract (C...) address. */
  address(value: string | Address): xdr.ScVal {
    if (value instanceof Address) {
      return value.toScVal();
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("sc.address requires a non-empty Stellar address string");
    }
    try {
      return new Address(value).toScVal();
    } catch (err) {
      throw new Error(
        `sc.address received an invalid Stellar address "${value}": ${(err as Error).message}`,
      );
    }
  },

  /** Builds an `scvI32` from a range-checked integer. */
  i32(value: unknown): xdr.ScVal {
    const n = assertRange(toBigIntStrict(value, "sc.i32"), I32_MIN, I32_MAX, "sc.i32");
    return nativeToScVal(Number(n), { type: "i32" });
  },

  /** Builds an `scvU32` from a range-checked integer. */
  u32(value: unknown): xdr.ScVal {
    const n = assertRange(toBigIntStrict(value, "sc.u32"), 0n, U32_MAX, "sc.u32");
    return nativeToScVal(Number(n), { type: "u32" });
  },

  /** Builds an `scvI64` from a range-checked integer. */
  i64(value: unknown): xdr.ScVal {
    const n = assertRange(toBigIntStrict(value, "sc.i64"), I64_MIN, I64_MAX, "sc.i64");
    return nativeToScVal(n, { type: "i64" });
  },

  /** Builds an `scvU64` from a range-checked integer. */
  u64(value: unknown): xdr.ScVal {
    const n = assertRange(toBigIntStrict(value, "sc.u64"), 0n, U64_MAX, "sc.u64");
    return nativeToScVal(n, { type: "u64" });
  },

  /** Builds an `scvI128` from a range-checked integer. */
  i128(value: unknown): xdr.ScVal {
    const n = assertRange(toBigIntStrict(value, "sc.i128"), I128_MIN, I128_MAX, "sc.i128");
    return nativeToScVal(n, { type: "i128" });
  },

  /** Builds an `scvU128` from a range-checked integer. */
  u128(value: unknown): xdr.ScVal {
    const n = assertRange(toBigIntStrict(value, "sc.u128"), 0n, U128_MAX, "sc.u128");
    return nativeToScVal(n, { type: "u128" });
  },

  /** Builds an `scvSymbol`, validating the charset and length. */
  symbol(value: string): xdr.ScVal {
    if (typeof value !== "string") {
      throw new Error("sc.symbol requires a string");
    }
    if (value.length === 0) {
      throw new Error("sc.symbol requires a non-empty string");
    }
    if (value.length > SYMBOL_MAX_LENGTH) {
      throw new Error(
        `sc.symbol exceeds ${SYMBOL_MAX_LENGTH} characters: "${value}" (${value.length})`,
      );
    }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      throw new Error(
        `sc.symbol contains invalid characters: "${value}" (allowed: a-z, A-Z, 0-9, _)`,
      );
    }
    return xdr.ScVal.scvSymbol(value);
  },

  /** Builds an `scvString`. */
  string(value: string): xdr.ScVal {
    if (typeof value !== "string") {
      throw new Error("sc.string requires a string");
    }
    return xdr.ScVal.scvString(value);
  },

  /** Builds an `scvBool`. */
  bool(value: boolean): xdr.ScVal {
    if (typeof value !== "boolean") {
      throw new Error("sc.bool requires a boolean");
    }
    return xdr.ScVal.scvBool(value);
  },

  /** Builds an `scvBytes` from a Buffer, Uint8Array or hex string. */
  bytes(value: Buffer | Uint8Array | string): xdr.ScVal {
    return xdr.ScVal.scvBytes(toBufferStrict(value, "sc.bytes"));
  },

  /** Builds an `scvVec` from a list of already-built ScVals. */
  vec(items: xdr.ScVal[]): xdr.ScVal {
    if (!Array.isArray(items)) {
      throw new Error("sc.vec requires an array of xdr.ScVal");
    }
    for (const item of items) {
      if (!(item instanceof xdr.ScVal)) {
        throw new Error("sc.vec items must be xdr.ScVal instances");
      }
    }
    return xdr.ScVal.scvVec(items);
  },

  /**
   * Builds an `scvMap` from key/value entries. Duplicate keys (compared by
   * their XDR encoding) are rejected.
   */
  map(entries: Array<{ key: xdr.ScVal; val: xdr.ScVal }> | Map<xdr.ScVal, xdr.ScVal>): xdr.ScVal {
    const list = entries instanceof Map
      ? Array.from(entries, ([key, val]) => ({ key, val }))
      : entries;
    if (!Array.isArray(list)) {
      throw new Error("sc.map requires an array of { key, val } entries or a Map");
    }
    const seen = new Set<string>();
    const scEntries: xdr.ScMapEntry[] = [];
    for (const entry of list) {
      if (!entry || !(entry.key instanceof xdr.ScVal) || !(entry.val instanceof xdr.ScVal)) {
        throw new Error("sc.map entries must contain xdr.ScVal key and val");
      }
      const fingerprint = entry.key.toXDR().toString("hex");
      if (seen.has(fingerprint)) {
        throw new Error("sc.map contains duplicate keys");
      }
      seen.add(fingerprint);
      scEntries.push(new xdr.ScMapEntry({ key: entry.key, val: entry.val }));
    }
    return xdr.ScVal.scvMap(scEntries);
  },

  /** Builds an `scvVoid`. */
  void(): xdr.ScVal {
    return xdr.ScVal.scvVoid();
  },
};

/**
 * Converts a JavaScript value or ContractArg into a Stellar Soroban xdr.ScVal.
 */
export function toScVal(input: ScValInput, explicitType?: ScValType): xdr.ScVal {
  if (input instanceof xdr.ScVal) {
    return input;
  }

  let value = input;
  let type = explicitType;

  if (
    input &&
    typeof input === "object" &&
    "value" in input &&
    ("type" in input || !explicitType)
  ) {
    value = input.value;
    type = explicitType ?? input.type;
  }

  if (type) {
    switch (type) {
      case "address":
        return sc.address(value.toString());
      case "symbol":
        return sc.symbol(value.toString());
      case "string":
        return sc.string(value.toString());
      case "bool":
        return sc.bool(Boolean(value));
      case "u32":
        return sc.u32(value);
      case "i32":
        return sc.i32(value);
      case "u64":
        return sc.u64(value);
      case "i64":
        return sc.i64(value);
      case "u128":
        return sc.u128(value);
      case "i128":
        return sc.i128(value);
      case "bytes":
        return sc.bytes(value as Buffer | Uint8Array | string);
      case "bytes32":
        return sc.bytes(toBytes32Buffer(value));
      case "timepoint":
        return sc.u64(value);
      case "duration":
        return sc.u64(value);
      case "price": {
        const price = normalizePrice(value);
        return sc.map([
          { key: sc.symbol("price"), val: sc.i128(price.price) },
          { key: sc.symbol("timestamp"), val: sc.u64(price.timestamp) },
        ]);
      }
      default:
        return nativeToScVal(value);
    }
  }

  // Type inference
  if (typeof value === "boolean") {
    return sc.bool(value);
  }
  if (typeof value === "bigint") {
    return sc.i128(value);
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? sc.i32(value)
      : sc.i128(BigInt(Math.floor(value)));
  }
  if (typeof value === "string") {
    // Check if string is Stellar Account or Contract address (length 56, starts with G or C)
    if (value.length === 56 && (value.startsWith("G") || value.startsWith("C"))) {
      try {
        return sc.address(value);
      } catch {
        // Fallback to string
      }
    }
    return sc.string(value);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return sc.bytes(Buffer.from(value));
  }

  return nativeToScVal(value);
}

/**
 * Normalizes a value into a 32-byte Buffer for `BytesN<32>` arguments such as
 * contract wasm hashes (#222, #224).
 *
 * Accepts a hex string (with or without `0x` prefix), a Buffer, or a
 * Uint8Array. Throws if the resulting length is not exactly 32 bytes.
 */
export function toBytes32Buffer(value: unknown): Buffer {
  let buf: Buffer;
  if (Buffer.isBuffer(value)) {
    buf = value;
  } else if (value instanceof Uint8Array) {
    buf = Buffer.from(value);
  } else if (typeof value === "string") {
    const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error(`Invalid BytesN<32> hex string: ${value}`);
    }
    buf = Buffer.from(hex, "hex");
  } else {
    throw new Error(`Unsupported BytesN<32> value: ${String(value)}`);
  }

  if (buf.length !== 32) {
    throw new Error(`Expected 32 bytes for BytesN<32>, got ${buf.length}`);
  }
  return buf;
}

/**
 * Normalizes an oracle price struct (#223) into `{ price: bigint, timestamp: bigint }`.
 *
 * Accepts either an object with `price`/`timestamp` fields or a tuple
 * `[price, timestamp]`. The price is treated as a fixed-point i128 value.
 */
export function normalizePrice(value: unknown): { price: bigint; timestamp: bigint } {
  if (Array.isArray(value)) {
    if (value.length < 2) {
      throw new Error("Price tuple must contain [price, timestamp]");
    }
    return { price: BigInt(value[0] as any), timestamp: BigInt(value[1] as any) };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.price === undefined || obj.timestamp === undefined) {
      throw new Error("Price object must contain 'price' and 'timestamp' fields");
    }
    return { price: BigInt(obj.price as any), timestamp: BigInt(obj.timestamp as any) };
  }
  throw new Error(`Unsupported price value: ${String(value)}`);
}

/**
 * Converts a Soroban xdr.ScVal into its native JavaScript representation.
 *
 * Handles all common ScVal types explicitly so contract return values can be
 * decoded reliably:
 *  - scvAddress -> string (StrKey G.../C...)
 *  - scvMap     -> plain object (string keys) or Map for non-string keys
 *  - scvVec     -> array
 *  - scvBytes   -> Uint8Array
 *  - scvBool    -> boolean
 *  - scvSymbol  -> string
 *  - scvI128    -> bigint
 *  - scvU128    -> bigint
 */
export function fromScVal(scVal: any): any {
  if (scVal === null || scVal === undefined) return null;

  // Unwrap common result envelopes before decoding.
  if (scVal && !(scVal instanceof xdr.ScVal)) {
    if (scVal.retval) {
      return fromScVal(scVal.retval);
    }
    if (scVal.result?.retval) {
      return fromScVal(scVal.result.retval);
    }
  }

  if (!(scVal instanceof xdr.ScVal)) {
    return scVal;
  }

  switch (scVal.switch()) {
    case xdr.ScValType.scvAddress():
      return Address.fromScVal(scVal).toString();
    case xdr.ScValType.scvMap(): {
      const entries = scVal.map() ?? [];
      const result: Record<string, any> = {};
      let allStringKeys = true;
      const map = new Map<any, any>();
      for (const entry of entries) {
        const key = fromScVal(entry.key());
        const val = fromScVal(entry.val());
        map.set(key, val);
        if (typeof key === "string") {
          result[key] = val;
        } else {
          allStringKeys = false;
        }
      }
      return allStringKeys ? result : map;
    }
    case xdr.ScValType.scvVec():
      return (scVal.vec() ?? []).map((item) => fromScVal(item));
    case xdr.ScValType.scvBytes():
      return new Uint8Array(scVal.bytes());
    case xdr.ScValType.scvBool():
      return scVal.b();
    case xdr.ScValType.scvSymbol():
      return scVal.sym().toString();
    case xdr.ScValType.scvI128():
      return scVal.i128().toBigInt();
    case xdr.ScValType.scvU128():
      return scVal.u128().toBigInt();
    case xdr.ScValType.scvU64():
      return scVal.u64().toBigInt();
    case xdr.ScValType.scvI64():
      return scVal.i64().toBigInt();
    case xdr.ScValType.scvU32():
      return scVal.u32();
    case xdr.ScValType.scvI32():
      return scVal.i32();
    case xdr.ScValType.scvTimepoint():
      return scVal.timepoint().toBigInt();
    case xdr.ScValType.scvDuration():
      return scVal.duration().toBigInt();
    default:
      return scValToNative(scVal);
  }
}

/**
 * Decodes a `BytesN<32>` ScVal (e.g. a contract wasm hash) into a lowercase
 * hex string. Throws if the value is not exactly 32 bytes.
 */
export function fromBytes32ScVal(scVal: xdr.ScVal): string {
  if (scVal.switch() !== xdr.ScValType.scvBytes()) {
    throw new Error("Expected scvBytes for BytesN<32>");
  }
  const buf = Buffer.from(scVal.bytes());
  if (buf.length !== 32) {
    throw new Error(`Expected 32 bytes for BytesN<32>, got ${buf.length}`);
  }
  return buf.toString("hex");
}

/**
 * Decodes an oracle price struct ScVal (#223) into `{ price: bigint, timestamp: bigint }`.
 *
 * Accepts either an scvMap with `price`/`timestamp` symbol keys or an scvVec
 * tuple `[price, timestamp]`.
 */
export function fromPriceScVal(scVal: xdr.ScVal): { price: bigint; timestamp: bigint } {
  const decoded = fromScVal(scVal);
  if (decoded instanceof Map) {
    const price = decoded.get("price");
    const timestamp = decoded.get("timestamp");
    if (price === undefined || timestamp === undefined) {
      throw new Error("Price map missing 'price' or 'timestamp'");
    }
    return { price: BigInt(price), timestamp: BigInt(timestamp) };
  }
  if (Array.isArray(decoded)) {
    if (decoded.length < 2) {
      throw new Error("Price tuple must contain [price, timestamp]");
    }
    return { price: BigInt(decoded[0]), timestamp: BigInt(decoded[1]) };
  }
  if (decoded && typeof decoded === "object") {
    const obj = decoded as Record<string, unknown>;
    if (obj.price === undefined || obj.timestamp === undefined) {
      throw new Error("Price object missing 'price' or 'timestamp'");
    }
    return { price: BigInt(obj.price as any), timestamp: BigInt(obj.timestamp as any) };
  }
  throw new Error("Unsupported price ScVal");
}
