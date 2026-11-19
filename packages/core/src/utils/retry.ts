/**
 * Shared retry/backoff utilities with exponential backoff, jitter and
 * AbortSignal support.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds. Defaults to 100. */
  baseDelay?: number;
  /** Maximum delay in milliseconds. Defaults to 30_000. */
  maxDelay?: number;
  /** Jitter factor in [0, 1]. Defaults to 0.2 (±20%). */
  jitter?: number;
  /** Optional AbortSignal to cancel retries and delays. */
  signal?: AbortSignal;
  /**
   * Predicate deciding whether an error is retryable.
   * Defaults to retrying all errors except AbortError.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before each retry delay. */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

export interface BackoffOptions {
  /** Base delay in milliseconds. Defaults to 100. */
  baseDelay?: number;
  /** Maximum delay in milliseconds. Defaults to 30_000. */
  maxDelay?: number;
  /** Jitter factor in [0, 1]. Defaults to 0.2. */
  jitter?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY = 100;
const DEFAULT_MAX_DELAY = 30_000;
const DEFAULT_JITTER = 0.2;

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

/**
 * Computes the backoff delay for a given attempt (0-based) using
 * exponential backoff with optional jitter, clamped to `maxDelay`.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
  const maxDelay = options.maxDelay ?? DEFAULT_MAX_DELAY;
  const jitter = options.jitter ?? DEFAULT_JITTER;

  const exponential = baseDelay * Math.pow(2, Math.max(0, attempt));
  const clamped = Math.min(exponential, maxDelay);

  if (jitter <= 0) {
    return Math.round(clamped);
  }

  const factor = 1 + (Math.random() * 2 - 1) * Math.min(jitter, 1);
  return Math.round(Math.min(Math.max(clamped * factor, 0), maxDelay));
}

/**
 * Returns a promise that resolves after `ms` milliseconds, rejecting with an
 * AbortError if the provided signal is aborted first.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Executes `fn` with retries using exponential backoff and jitter.
 * Aborts immediately when the provided signal is aborted.
 */
export async function retry<T>(
  fn: (attempt: number, signal?: AbortSignal) => Promise<T> | T,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const { signal } = options;
  const shouldRetry =
    options.shouldRetry ?? ((error: unknown) => !isAbortError(error));

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfAborted(signal);

    try {
      return await fn(attempt, signal);
    } catch (error) {
      lastError = error;

      if (signal?.aborted || isAbortError(error)) {
        throw error;
      }

      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt || !shouldRetry(error, attempt)) {
        throw error;
      }

      const wait = backoffDelay(attempt, {
        baseDelay: options.baseDelay,
        maxDelay: options.maxDelay,
        jitter: options.jitter,
      });

      options.onRetry?.(error, attempt + 1, wait);

      await delay(wait, signal);
    }
  }

  throw lastError;
}