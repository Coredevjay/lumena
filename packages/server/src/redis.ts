import { readFileSync } from "node:fs";
import { Redis, type RedisOptions } from "ioredis";

/**
 * Redis connection settings resolved from the environment.
 *
 * All Redis clients in the server MUST be created through `createRedisClient`
 * so that key prefixing, TLS and ACL credentials are applied consistently.
 */
export interface RedisConfig {
  /** Connection URL (`redis://`, `rediss://`, `unix://`). */
  url?: string;
  /** Prefix applied to every key written by this process. */
  keyPrefix: string;
  /** ACL username (Redis 6+). */
  username?: string;
  /** ACL password. */
  password?: string;
  /** Database index. */
  db?: number;
  /** Enable TLS. Implied by a `rediss://` URL. */
  tls: boolean;
  /** Skip TLS certificate verification (development only). */
  tlsInsecure: boolean;
  /** Optional path to a CA bundle used to verify the server certificate. */
  tlsCaFile?: string;
}

export const DEFAULT_REDIS_KEY_PREFIX = "lumen:";

export type RedisConfigResult =
  | { ok: true; value: RedisConfig }
  | { ok: false; error: string };

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

/**
 * Parse and validate Redis settings from the environment.
 *
 * Supported variables:
 *   REDIS_URL              connection URL (redis://, rediss://, unix://)
 *   REDIS_KEY_PREFIX       key namespace prefix (default "lumen:")
 *   REDIS_USERNAME         ACL username
 *   REDIS_PASSWORD         ACL password
 *   REDIS_DB               database index (non-negative integer)
 *   REDIS_TLS              "true" to enable TLS
 *   REDIS_TLS_INSECURE     "true" to skip certificate verification
 *   REDIS_TLS_CA_FILE      path to a CA bundle
 */
export function parseRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfigResult {
  const url = env.REDIS_URL?.trim() || undefined;

  if (url !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `REDIS_URL: invalid URL "${url}"` };
    }
    if (!["redis:", "rediss:", "unix:"].includes(parsed.protocol)) {
      return {
        ok: false,
        error: `REDIS_URL: unsupported protocol "${parsed.protocol}" (expected redis:, rediss: or unix:)`,
      };
    }
  }

  const rawPrefix = env.REDIS_KEY_PREFIX;
  const keyPrefix = rawPrefix === undefined ? DEFAULT_REDIS_KEY_PREFIX : rawPrefix.trim();
  if (keyPrefix.length > 0 && !/^[A-Za-z0-9._:-]+$/.test(keyPrefix)) {
    return {
      ok: false,
      error: "REDIS_KEY_PREFIX: may only contain letters, digits, '.', '_', ':' and '-'",
    };
  }

  const username = env.REDIS_USERNAME?.trim() || undefined;
  const password = env.REDIS_PASSWORD || undefined;
  if (username !== undefined && password === undefined) {
    return { ok: false, error: "REDIS_USERNAME: requires REDIS_PASSWORD to be set" };
  }

  let db: number | undefined;
  const rawDb = env.REDIS_DB;
  if (rawDb !== undefined && rawDb.trim() !== "") {
    const parsedDb = Number(rawDb);
    if (!Number.isInteger(parsedDb) || parsedDb < 0) {
      return { ok: false, error: `REDIS_DB: expected a non-negative integer, got "${rawDb}"` };
    }
    db = parsedDb;
  }

  const urlImpliesTls = url?.startsWith("rediss://") ?? false;
  const tls = parseBoolean(env.REDIS_TLS, urlImpliesTls);
  const tlsInsecure = parseBoolean(env.REDIS_TLS_INSECURE, false);
  const tlsCaFile = env.REDIS_TLS_CA_FILE?.trim() || undefined;

  if (tlsInsecure && !tls) {
    return { ok: false, error: "REDIS_TLS_INSECURE: requires REDIS_TLS=true" };
  }
  if (tlsCaFile !== undefined && !tls) {
    return { ok: false, error: "REDIS_TLS_CA_FILE: requires REDIS_TLS=true" };
  }

  return {
    ok: true,
    value: { url, keyPrefix, username, password, db, tls, tlsInsecure, tlsCaFile },
  };
}

/**
 * Build ioredis options from a resolved Redis config.
 */
export function buildRedisOptions(config: RedisConfig): RedisOptions {
  const options: RedisOptions = {
    keyPrefix: config.keyPrefix,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  };

  if (config.username !== undefined) options.username = config.username;
  if (config.password !== undefined) options.password = config.password;
  if (config.db !== undefined) options.db = config.db;

  if (config.tls) {
    options.tls = {
      rejectUnauthorized: !config.tlsInsecure,
      ...(config.tlsCaFile !== undefined ? { ca: [readFileSync(config.tlsCaFile, "utf8")] } : {}),
    };
  }

  return options;
}

/**
 * The single factory every Redis client in the server must go through.
 */
export function createRedisClient(config: RedisConfig): Redis {
  const options = buildRedisOptions(config);
  return config.url !== undefined ? new Redis(config.url, options) : new Redis(options);
}
