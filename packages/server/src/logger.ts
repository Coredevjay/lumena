import pino from 'pino';
import pinoHttp from 'pino-http';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Placeholder substituted for every redacted value.
 *
 * Kept as a constant so tests and docs can assert on a single token.
 */
export const REDACTED = '[redacted]';

/**
 * Canonical list of log paths that must never contain raw values.
 *
 * Documented in `docs/logging-redaction.md`; keep both in sync.
 *
 * - `authorization` / `x-api-key` / `cookie` / `set-cookie`: credentials.
 * - `body.xdr`, `*.xdr`: base64 Soroban transaction envelopes.
 * - `secret`, `secretKey`, `seed`, `privateKey`, `mnemonic`, `password`,
 *   `apiKey`, `token`, `signature`: key material and bearer tokens.
 * - `address`, `publicKey`, `account`, `sourceAccount`, `contractId`:
 *   Stellar addresses (G.../C.../M...) are treated as PII.
 * - `txHash`, `transactionHash`, `hash`: transaction identifiers.
 * - `err.stack`, `error.stack`, `stack`: internal stack traces.
 */
export const REDACT_PATHS: readonly string[] = [
  // Credentials
  'authorization',
  'Authorization',
  'headers.authorization',
  'headers.Authorization',
  'req.headers.authorization',
  'req.headers.Authorization',
  'x-api-key',
  'X-Api-Key',
  'headers.x-api-key',
  'headers["x-api-key"]',
  'req.headers.x-api-key',
  'req.headers["x-api-key"]',
  'cookie',
  'headers.cookie',
  'req.headers.cookie',
  'set-cookie',
  'res.headers["set-cookie"]',
  // Raw XDR envelopes
  'xdr',
  'body.xdr',
  'req.body.xdr',
  '*.xdr',
  '*.body.xdr',
  // Secret material
  'secret',
  'secretKey',
  'seed',
  'privateKey',
  'mnemonic',
  'password',
  'apiKey',
  'token',
  'signature',
  '*.secret',
  '*.secretKey',
  '*.seed',
  '*.privateKey',
  '*.mnemonic',
  '*.password',
  '*.apiKey',
  '*.token',
  '*.signature',
  'body.secret',
  'body.secretKey',
  'body.seed',
  'body.privateKey',
  'body.mnemonic',
  'body.password',
  'body.apiKey',
  'body.token',
  'body.signature',
  'req.body.secret',
  'req.body.secretKey',
  'req.body.seed',
  'req.body.privateKey',
  'req.body.mnemonic',
  'req.body.password',
  'req.body.apiKey',
  'req.body.token',
  'req.body.signature',
  // Stellar addresses
  'address',
  'publicKey',
  'account',
  'sourceAccount',
  'contractId',
  '*.address',
  '*.publicKey',
  '*.account',
  '*.sourceAccount',
  '*.contractId',
  'body.address',
  'body.publicKey',
  'body.account',
  'body.sourceAccount',
  'body.contractId',
  'req.body.address',
  'req.body.publicKey',
  'req.body.account',
  'req.body.sourceAccount',
  'req.body.contractId',
  // Transaction identifiers
  'txHash',
  'transactionHash',
  'hash',
  '*.txHash',
  '*.transactionHash',
  '*.hash',
  // Stack traces
  'err.stack',
  'error.stack',
  'stack',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  // In production, avoid leaking internal details (stack traces, raw values)
  // into logs that may be surfaced to clients. Structured logging keeps
  // internal diagnostics server-side only.
  redact: {
    paths: [...REDACT_PATHS],
    censor: REDACTED,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }),
});

/**
 * HTTP request logger middleware.
 *
 * Shares the redaction configuration of {@link logger} so request headers
 * (`authorization`, `x-api-key`, cookies) and bodies (`xdr`, secrets,
 * addresses) are censored before serialization.
 */
export const httpLogger = pinoHttp({
  logger,
  redact: {
    paths: [...REDACT_PATHS],
    censor: REDACTED,
  },
  serializers: {
    req(req: { method?: string; url?: string; headers?: Record<string, unknown> }) {
      return { method: req.method, url: req.url, headers: req.headers };
    },
  },
});

/** Log levels supported by Pino, used to validate runtime reloads. */
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Change the logger level at runtime (e.g. on SIGHUP config reload).
 *
 * Invalid levels are rejected: a warning is logged and the previous level is
 * kept so a bad config can never silence or break logging.
 *
 * @returns `true` if the level was applied, `false` if it was rejected.
 */
export function setLogLevel(level: unknown): boolean {
  if (typeof level !== 'string' || !(LOG_LEVELS as readonly string[]).includes(level)) {
    logger.warn(
      { requestedLevel: level, currentLevel: logger.level, supported: LOG_LEVELS },
      'Invalid log level requested; keeping current level',
    );
    return false;
  }

  logger.level = level;
  logger.info({ level }, 'Log level updated');
  return true;
}

/**
 * Sanitize an error message for safe inclusion in API responses.
 *
 * In production, internal details such as stack traces and raw Stellar
 * transaction hashes must never be returned to clients. Internal details
 * are logged via Pino instead.
 */
export function sanitizeErrorMessage(
  error: unknown,
  fallback = 'An unexpected error occurred',
): string {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;

  if (isProduction) {
    // Log the full internal detail server-side, return a generic message.
    logger.error({ err: error }, 'Internal error sanitized for API response');
    return fallback;
  }

  return message;
}

/**
 * Strip stack traces from an error object before it is serialized into an
 * API response. In production the stack is removed entirely; in other
 * environments it is preserved for debugging.
 */
export function sanitizeError(error: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    message: sanitizeErrorMessage(error),
  };

  if (!isProduction && error instanceof Error && error.stack) {
    base.stack = error.stack;
  }

  return base;
}

/**
 * Structured audit-log entry for RBAC access decisions.
 *
 * Records who attempted what, on which route, and whether it was allowed.
 * Sensitive fields (transaction hashes, stack traces) remain redacted by the
 * logger configuration above.
 */
export interface AuditLogEntry {
  /** Identifier of the authenticated actor (e.g. JWT `sub`). */
  actorId: string | null;
  /** Role carried by the actor's JWT claim. */
  role: string | null;
  /** Action being attempted, e.g. `policy:update`. */
  action: string;
  /** HTTP method and path of the attempted request. */
  route: string;
  /** Outcome of the permission check. */
  decision: 'allow' | 'deny';
  /** Optional reason for the decision (e.g. `insufficient_role`). */
  reason?: string;
  /** ISO-8601 timestamp of the access attempt. */
  timestamp?: string;
}

/**
 * Write a structured audit-log entry for an RBAC access decision.
 *
 * Allowed decisions are logged at `info`; denied decisions at `warn` so they
 * are easy to surface in alerting. The actor ID and timestamp are always
 * included.
 */
export function auditLog(entry: AuditLogEntry): void {
  const record = {
    audit: true,
    actorId: entry.actorId,
    role: entry.role,
    action: entry.action,
    route: entry.route,
    decision: entry.decision,
    ...(entry.reason ? { reason: entry.reason } : {}),
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };

  if (entry.decision === 'deny') {
    logger.warn(record, 'RBAC access denied');
  } else {
    logger.info(record, 'RBAC access granted');
  }
}
