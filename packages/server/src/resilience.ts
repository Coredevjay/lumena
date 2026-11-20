import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.js";

/**
 * Resilience layer for outbound Horizon / Soroban RPC calls (#493).
 *
 * Defaults (all overridable via env, see docs/resilience.md):
 * - timeout: 5_000 ms per attempt
 * - retries: 2 (3 attempts total) for idempotent reads only
 * - backoff: 100 ms base, exponential, full jitter, capped at 2_000 ms
 * - breaker: opens after 5 consecutive failures, 30 s cooldown, 1 half-open probe
 */

export interface ResilienceOptions {
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
  /** Number of retries after the first attempt (idempotent reads only). */
  retries?: number;
  /** Base backoff in milliseconds (exponential with full jitter). */
  baseBackoffMs?: number;
  /** Maximum backoff in milliseconds. */
  maxBackoffMs?: number;
  /** Consecutive failures that trip the breaker. */
  failureThreshold?: number;
  /** Cooldown in milliseconds before a half-open probe is allowed. */
  cooldownMs?: number;
  /** Label used for metrics, e.g. "horizon" or "rpc". */
  target?: string;
  /** Injectable clock/sleep/random for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const RESILIENCE_DEFAULTS = {
  timeoutMs: 5_000,
  retries: 2,
  baseBackoffMs: 100,
  maxBackoffMs: 2_000,
  failureThreshold: 5,
  cooldownMs: 30_000,
} as const;

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export type BreakerState = "closed" | "open" | "half_open";

const breakerStateGauge = new Gauge({
  name: "lumen_upstream_breaker_state",
  help: "Circuit breaker state for outbound Stellar calls (0=closed, 1=half_open, 2=open)",
  labelNames: ["target"],
  registers: [register],
});

const breakerTripsTotal = new Counter({
  name: "lumen_upstream_breaker_trips_total",
  help: "Number of times the outbound circuit breaker opened",
  labelNames: ["target"],
  registers: [register],
});

const upstreamRequestsTotal = new Counter({
  name: "lumen_upstream_requests_total",
  help: "Outbound Stellar requests by target and outcome",
  labelNames: ["target", "outcome"],
  registers: [register],
});

const STATE_VALUE: Record<BreakerState, number> = { closed: 0, half_open: 1, open: 2 };

/** Simple consecutive-failure circuit breaker with a single half-open probe. */
export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    private readonly opts: Required<
      Pick<ResilienceOptions, "failureThreshold" | "cooldownMs" | "target" | "now">
    >,
  ) {
    breakerStateGauge.set({ target: this.opts.target }, STATE_VALUE.closed);
  }

  get currentState(): BreakerState {
    if (this.state === "open" && this.opts.now() - this.openedAt >= this.opts.cooldownMs) {
      this.state = "half_open";
      this.probing = false;
      breakerStateGauge.set({ target: this.opts.target }, STATE_VALUE.half_open);
    }
    return this.state;
  }

  /** Throws {@link CircuitOpenError} when the breaker refuses traffic. */
  assertClosed(): void {
    const state = this.currentState;
    if (state === "open") {
      throw new CircuitOpenError(`Circuit breaker open for ${this.opts.target}`);
    }
    if (state === "half_open") {
      if (this.probing) {
        throw new CircuitOpenError(`Circuit breaker half-open for ${this.opts.target}`);
      }
      this.probing = true;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.probing = false;
    if (this.state !== "closed") {
      this.state = "closed";
      breakerStateGauge.set({ target: this.opts.target }, STATE_VALUE.closed);
    }
  }

  recordFailure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.opts.failureThreshold) {
      this.state = "open";
      this.openedAt = this.opts.now();
      breakerTripsTotal.inc({ target: this.opts.target });
      breakerStateGauge.set({ target: this.opts.target }, STATE_VALUE.open);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** True for errors that are safe to retry (network/timeout/5xx-ish). */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof CircuitOpenError) return false;
  const e = err as { response?: { status?: number }; status?: number; code?: string } | null;
  const status = e?.response?.status ?? e?.status;
  if (typeof status === "number") return status >= 500 || status === 429 || status === 408;
  const code = e?.code;
  if (code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }
  // Unknown errors (e.g. SDK network failures) are treated as retryable.
  return true;
}

/**
 * Resilience wrapper around a single upstream target.
 *
 * `read()` retries idempotent calls with jittered exponential backoff; `write()`
 * never retries (submissions are not idempotent) but still honours the timeout
 * and breaker.
 */
export class ResilientUpstream {
  readonly breaker: CircuitBreaker;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly target: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: ResilienceOptions = {}) {
    this.target = opts.target ?? "stellar";
    this.timeoutMs = opts.timeoutMs ?? RESILIENCE_DEFAULTS.timeoutMs;
    this.retries = opts.retries ?? RESILIENCE_DEFAULTS.retries;
    this.baseBackoffMs = opts.baseBackoffMs ?? RESILIENCE_DEFAULTS.baseBackoffMs;
    this.maxBackoffMs = opts.maxBackoffMs ?? RESILIENCE_DEFAULTS.maxBackoffMs;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.breaker = new CircuitBreaker({
      failureThreshold: opts.failureThreshold ?? RESILIENCE_DEFAULTS.failureThreshold,
      cooldownMs: opts.cooldownMs ?? RESILIENCE_DEFAULTS.cooldownMs,
      target: this.target,
      now: opts.now ?? Date.now,
    });
  }

  /** Jittered exponential backoff delay for attempt `n` (0-based). */
  backoffDelay(attempt: number): number {
    const ceiling = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** attempt);
    return Math.floor(this.random() * ceiling);
  }

  /** Idempotent read: timeout + jittered retries + breaker. */
  async read<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.attempt(fn);
      } catch (err) {
        lastErr = err;
        if (err instanceof CircuitOpenError || !isRetryable(err) || attempt === this.retries) {
          throw err;
        }
        await this.sleep(this.backoffDelay(attempt));
      }
    }
    throw lastErr;
  }

  /** Non-idempotent write: timeout + breaker, no retries. */
  async write<T>(fn: () => Promise<T>): Promise<T> {
    return this.attempt(fn);
  }

  private async attempt<T>(fn: () => Promise<T>): Promise<T> {
    this.breaker.assertClosed();
    try {
      const result = await withTimeout(fn(), this.timeoutMs, this.target);
      this.breaker.recordSuccess();
      upstreamRequestsTotal.inc({ target: this.target, outcome: "success" });
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      this.breaker.recordFailure();
      upstreamRequestsTotal.inc({
        target: this.target,
        outcome: err instanceof TimeoutError ? "timeout" : "error",
      });
      throw err;
    }
  }
}

/** Builds a {@link ResilientUpstream} from env vars with documented defaults. */
export function resilientUpstreamFromEnv(
  target: "horizon" | "rpc",
  env: NodeJS.ProcessEnv = process.env,
): ResilientUpstream {
  const prefix = target === "horizon" ? "HORIZON" : "SOROBAN_RPC";
  const num = (name: string, fallback: number): number => {
    const raw = env[`${prefix}_${name}`];
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return new ResilientUpstream({
    target,
    timeoutMs: num("TIMEOUT_MS", RESILIENCE_DEFAULTS.timeoutMs),
    retries: num("RETRIES", RESILIENCE_DEFAULTS.retries),
    baseBackoffMs: num("BACKOFF_MS", RESILIENCE_DEFAULTS.baseBackoffMs),
    maxBackoffMs: num("MAX_BACKOFF_MS", RESILIENCE_DEFAULTS.maxBackoffMs),
    failureThreshold: num("BREAKER_FAILURES", RESILIENCE_DEFAULTS.failureThreshold),
    cooldownMs: num("BREAKER_COOLDOWN_MS", RESILIENCE_DEFAULTS.cooldownMs),
  });
}
