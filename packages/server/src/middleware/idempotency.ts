import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash } from 'crypto';

/**
 * Minimal Redis client interface required by the idempotency middleware.
 * Compatible with `ioredis` and `redis` (v4+) clients.
 */
export interface IdempotencyRedisClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Storage backend used to persist idempotency records.
 *
 * - `memory`: process-local store, suitable for single-instance deployments
 *   and tests. Records are evicted once their TTL elapses.
 * - `redis`: shared store, required for multi-instance deployments.
 *
 * Selected via the `IDEMPOTENCY_STORE` environment variable or the
 * `store` option (the option takes precedence).
 */
export type IdempotencyStoreKind = 'memory' | 'redis';

export interface IdempotencyOptions {
  /**
   * Redis client used to persist idempotency records. Required when the
   * selected store is `redis` (the default when a client is provided).
   */
  redis?: IdempotencyRedisClient;
  /**
   * Storage backend. Defaults to `IDEMPOTENCY_STORE` (env) or `redis` when a
   * `redis` client is supplied, otherwise `memory`.
   */
  store?: IdempotencyStoreKind;
  /**
   * Time-to-live for idempotency records, in seconds. Defaults to
   * `IDEMPOTENCY_TTL_SECONDS` (env) or 24 hours.
   */
  ttlSeconds?: number;
  /** Header name carrying the idempotency key. Defaults to `Idempotency-Key`. */
  headerName?: string;
  /** Key prefix used in the store. Defaults to `idempotency:`. */
  keyPrefix?: string;
  /** Poll interval (ms) while awaiting an in-flight request. Defaults to 100ms. */
  pollIntervalMs?: number;
  /** Maximum time (ms) to await an in-flight request before giving up. Defaults to 30s. */
  maxWaitMs?: number;
}

/**
 * Storage abstraction backing the idempotency middleware. Implementations
 * must honour the TTL passed to `set` so expired records are never replayed.
 */
export interface IdempotencyStore {
  get(key: string): Promise<string | null>;
  /**
   * Stores `value` under `key`.
   *
   * When `nx` is true the write must only succeed if the key is absent
   * (returns `true` on success, `false` otherwise). Otherwise the write
   * always succeeds and returns `true`.
   */
  set(key: string, value: string, ttlMs: number, nx?: boolean): Promise<boolean>;
  del(key: string): Promise<void>;
}

/** HTTP methods considered mutating and therefore eligible for idempotency. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_HEADER_NAME = 'Idempotency-Key';
const DEFAULT_KEY_PREFIX = 'idempotency:';
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_WAIT_MS = 30_000;

/**
 * Resolves the configured TTL in seconds from the explicit option, falling
 * back to `IDEMPOTENCY_TTL_SECONDS`, then the 24h default. Invalid or
 * non-positive values fall back to the default.
 */
function resolveTtlSeconds(option?: number): number {
  if (typeof option === 'number' && Number.isFinite(option) && option > 0) {
    return option;
  }
  const fromEnv = process.env.IDEMPOTENCY_TTL_SECONDS;
  if (fromEnv !== undefined && fromEnv !== '') {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TTL_SECONDS;
}

/**
 * Resolves the storage backend from the explicit option, falling back to
 * `IDEMPOTENCY_STORE`, then `redis` when a client is supplied, else `memory`.
 */
function resolveStoreKind(
  option: IdempotencyStoreKind | undefined,
  hasRedis: boolean
): IdempotencyStoreKind {
  if (option === 'memory' || option === 'redis') {
    return option;
  }
  const fromEnv = (process.env.IDEMPOTENCY_STORE || '').trim().toLowerCase();
  if (fromEnv === 'memory' || fromEnv === 'redis') {
    return fromEnv;
  }
  return hasRedis ? 'redis' : 'memory';
}

/**
 * In-memory store with per-record expiry. Intended for single-instance
 * deployments and tests; records are dropped lazily on access and swept
 * periodically to bound memory usage.
 */
export function createMemoryStore(now: () => number = Date.now): IdempotencyStore {
  interface Entry {
    value: string;
    expiresAt: number;
  }
  const entries = new Map<string, Entry>();

  const isExpired = (entry: Entry): boolean => entry.expiresAt <= now();

  const sweep = (): void => {
    for (const [key, entry] of entries) {
      if (isExpired(entry)) {
        entries.delete(key);
      }
    }
  };

  return {
    async get(key: string): Promise<string | null> {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }
      if (isExpired(entry)) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ttlMs: number, nx = false): Promise<boolean> {
      sweep();
      const existing = entries.get(key);
      if (existing && isExpired(existing)) {
        entries.delete(key);
      }
      if (nx && entries.has(key)) {
        return false;
      }
      entries.set(key, { value, expiresAt: now() + ttlMs });
      return true;
    },
    async del(key: string): Promise<void> {
      entries.delete(key);
    },
  };
}

/** Adapts a Redis client to the {@link IdempotencyStore} interface. */
export function createRedisStore(
  client: IdempotencyRedisClient,
  keyPrefix = ''
): IdempotencyStore {
  return {
    async get(key: string): Promise<string | null> {
      return client.get(`${keyPrefix}${key}`);
    },
    async set(key: string, value: string, ttlMs: number, nx = false): Promise<boolean> {
      const args: Array<string | number> = ['PX', ttlMs];
      if (nx) {
        args.push('NX');
      }
      const result = await client.set(`${keyPrefix}${key}`, value, ...args);
      if (nx) {
        return result !== null && result !== undefined && result !== 'OK' ? true : result === 'OK';
      }
      return result !== null && result !== undefined;
    },
    async del(key: string): Promise<void> {
      await client.del(`${keyPrefix}${key}`);
    },
  };
}

interface StoredRecord {
  state: 'in-progress' | 'completed';
  fingerprint: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  createdAt: number;
}

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Headers that should not be replayed from a cached response, since they are
 * connection-specific or would otherwise confuse the client/proxy.
 */
const EXCLUDED_REPLAY_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'date',
]);

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function computeFingerprint(req: Request): string {
  const method = req.method.toUpperCase();
  const path = req.originalUrl || req.url || req.path || '';
  const body = req.body !== undefined ? JSON.stringify(req.body) : '';
  return sha256(`${method}\n${path}\n${sha256(body)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRecord(raw: string | null): StoredRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredRecord;
    if (!parsed || typeof parsed !== 'object' || !parsed.state) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function replayResponse(res: Response, record: StoredRecord): void {
  if (typeof record.status === 'number') {
    res.status(record.status);
  }
  if (record.headers) {
    for (const [name, value] of Object.entries(record.headers)) {
      if (!EXCLUDED_REPLAY_HEADERS.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }
  }
  res.setHeader('Idempotent-Replayed', 'true');
  if (record.body !== undefined) {
    res.send(record.body);
  } else {
    res.end();
  }
}

function sendConflict(res: Response): void {
  res.status(422).json({
    error: 'Idempotency key reuse with a different request payload',
    code: 'IDEMPOTENCY_KEY_MISMATCH',
  });
}

/**
 * Captures the response status, headers, and body written by the downstream
 * handler so they can be persisted and replayed for subsequent requests.
 */
function captureResponse(res: Response): { restore: () => void; get: () => CapturedResponse } {
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  const chunks: Buffer[] = [];
  let captured = false;

  const collect = (chunk: unknown): void => {
    if (chunk === undefined || chunk === null) {
      return;
    }
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(String(chunk)));
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).write = function patchedWrite(
    chunk: any,
    encoding?: any,
    callback?: any
  ): boolean {
    collect(chunk);
    return originalWrite(chunk, encoding, callback);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).end = function patchedEnd(
    chunk?: any,
    encoding?: any,
    callback?: any
  ): Response {
    if (!captured) {
      captured = true;
      collect(chunk);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalEnd as any)(chunk, encoding, callback);
  };

  const get = (): CapturedResponse => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(res.getHeaders())) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        headers[name] = value.join(', ');
      } else {
        headers[name] = String(value);
      }
    }
    return {
      status: res.statusCode,
      headers,
      body: Buffer.concat(chunks).toString('utf8'),
    };
  };

  const restore = (): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write = originalWrite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).end = originalEnd;
  };

  return { restore, get };
}

/**
 * Creates an RFC 7231 `Idempotency-Key` middleware.
 *
 * Configuration:
 * - `IDEMPOTENCY_TTL_SECONDS` (or `ttlSeconds`): record lifetime in seconds.
 *   Defaults to 24 hours. Expired records are treated as absent, so a key may
 *   be reused once its TTL elapses.
 * - `IDEMPOTENCY_STORE` (or `store`): `memory` or `redis`. Defaults to `redis`
 *   when a client is supplied, otherwise `memory`.
 *
 * Behaviour:
 * - Reads the `Idempotency-Key` header on mutating requests; passes through if absent.
 * - Computes a request fingerprint (method + path + body hash).
 * - Persists an in-progress marker (`SET NX PX`) before executing the handler.
 * - Captures the response and persists a completed record with the configured TTL.
 * - Concurrent requests with the same key await the in-flight execution (local
 *   promise map + store polling) and replay the cached response.
 * - Conflict behaviour: reusing a key with a *different* payload (fingerprint)
 *   is rejected with HTTP 422 (`IDEMPOTENCY_KEY_MISMATCH`). Reusing a key with
 *   the *same* payload replays the stored response (with `Idempotent-Replayed: true`).
 */
export function idempotency(options: IdempotencyOptions): RequestHandler {
  const {
    redis,
    headerName = DEFAULT_HEADER_NAME,
    keyPrefix = DEFAULT_KEY_PREFIX,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = options;

  const ttlSeconds = resolveTtlSeconds(options.ttlSeconds);
  const storeKind = resolveStoreKind(options.store, Boolean(redis));

  if (storeKind === 'redis' && !redis) {
    throw new Error('idempotency middleware requires a redis client when store is "redis"');
  }

  const store: IdempotencyStore =
    storeKind === 'redis' && redis
      ? createRedisStore(redis, keyPrefix)
      : createMemoryStore();

  const ttlMs = ttlSeconds * 1000;
  const lowerHeaderName = headerName.toLowerCase();

  // Tracks in-flight executions within this process so concurrent requests can
  // await the same promise instead of polling Redis.
  const inFlight = new Map<string, Promise<CapturedResponse | null>>();

  async function awaitInFlight(
    redisKey: string,
    fingerprint: string
  ): Promise<StoredRecord | null> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const record = parseRecord(await store.get(redisKey));

      if (record) {
        if (record.fingerprint !== fingerprint) {
          return { state: 'completed', fingerprint, status: 422 } as StoredRecord;
        }
        if (record.state === 'completed') {
          return record;
        }
      } else {
        // The in-progress marker expired or was removed without a completed
        // record being written. Treat as available for re-execution.
        return null;
      }

      await sleep(pollIntervalMs);
    }

    return null;
  }

  return function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const method = req.method.toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      next();
      return;
    }

    const rawKey = req.headers[lowerHeaderName];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      next();
      return;
    }

    const redisKey = `${keyPrefix}${idempotencyKey}`;
    const fingerprint = computeFingerprint(req);

    const handle = async (): Promise<void> => {
      // Fast path: check for an existing record before attempting to lock.
      const existing = parseRecord(await store.get(redisKey));
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          sendConflict(res);
          return;
        }
        if (existing.state === 'completed') {
          replayResponse(res, existing);
          return;
        }
        // In-progress record exists; fall through to await it.
      }

      // Try to acquire the lock / in-progress marker.
      const lockValue = JSON.stringify({
        state: 'in-progress',
        fingerprint,
        createdAt: Date.now(),
      } satisfies StoredRecord);

      const acquired = await store.set(redisKey, lockValue, ttlMs, true);

      if (!acquired) {
        // Another request holds the lock. Await its completion.
        const pending = inFlight.get(redisKey);
        if (pending) {
          const result = await pending;
          if (result) {
            replayResponse(res, {
              state: 'completed',
              fingerprint,
              status: result.status,
              headers: result.headers,
              body: result.body,
              createdAt: Date.now(),
            });
            return;
          }
        }

        const record = await awaitInFlight(redisKey, fingerprint);
        if (record) {
          if (record.status === 422 && record.fingerprint === fingerprint && !record.headers) {
            sendConflict(res);
            return;
          }
          if (record.fingerprint !== fingerprint) {
            sendConflict(res);
            return;
          }
          replayResponse(res, record);
          return;
        }

        // Could not resolve the in-flight request; retry by executing.
        next();
        return;
      }

      // We own the lock. Execute the handler and capture the response.
      const execution = new Promise<CapturedResponse | null>((resolve) => {
        const capture = captureResponse(res);

        const finalize = async (): Promise<void> => {
          capture.restore();
          const captured = capture.get();
          try {
            const completed: StoredRecord = {
              state: 'completed',
              fingerprint,
              status: captured.status,
              headers: captured.headers,
              body: captured.body,
              createdAt: Date.now(),
            };
            await store.set(redisKey, JSON.stringify(completed), ttlMs);
          } catch {
            // Persisting the completed record failed; best-effort cleanup so
            // the key is not stuck in-progress.
            try {
              await store.del(redisKey);
            } catch {
              /* ignore */
            }
          } finally {
            inFlight.delete(redisKey);
          }
          resolve(captured);
        };

        res.once('finish', () => {
          void finalize();
        });
        res.once('close', () => {
          // Client disconnected before finish; still attempt to finalize so
          // the lock is released.
          if (!res.writableEnded) {
            void finalize();
          }
        });

        try {
          next();
        } catch (err) {
          capture.restore();
          inFlight.delete(redisKey);
          void store.del(redisKey).catch(() => undefined);
          resolve(null);
          next(err);
        }
      });

      inFlight.set(redisKey, execution);
      await execution;
    };

    handle().catch((err) => {
      // Ensure the lock is released on unexpected errors.
      inFlight.delete(redisKey);
      void store.del(redisKey).catch(() => undefined);
      next(err);
    });
  };
}

export default idempotency;