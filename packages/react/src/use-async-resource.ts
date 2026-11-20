import { useCallback, useEffect, useRef, useState } from "react";

export interface UseAsyncResourceOptions<T> {
  /** Loads data; aborted when dependencies change or the hook unmounts. */
  fetcher: (signal: AbortSignal) => Promise<T>;
  /** Poll interval in ms; 0 disables polling. */
  pollInterval?: number;
  /** Refetch when the tab regains focus. Defaults to true. */
  refetchOnFocus?: boolean;
  /** Upper bound for exponential backoff after errors (ms). */
  maxBackoffMs?: number;
  /** When false, no fetch runs until enabled. Defaults to true. */
  enabled?: boolean;
}

export interface UseAsyncResourceResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const DEFAULT_MAX_BACKOFF = 60_000;

/**
 * Shared async resource hook with polling, window-focus refetch, abort, and
 * exponential backoff on repeated failures.
 */
export function useAsyncResource<T>(
  options: UseAsyncResourceOptions<T>,
): UseAsyncResourceResult<T> {
  const {
    fetcher,
    pollInterval = 0,
    refetchOnFocus = true,
    maxBackoffMs = DEFAULT_MAX_BACKOFF,
    enabled = true,
  } = options;

  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const failureCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    try {
      const next = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setData(next);
      setError(null);
      failureCountRef.current = 0;
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      failureCountRef.current += 1;
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    void refetch();

    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const schedulePoll = () => {
      if (pollInterval <= 0) return;
      const backoff = Math.min(
        pollInterval * 2 ** failureCountRef.current,
        maxBackoffMs,
      );
      const delay = failureCountRef.current > 0 ? backoff : pollInterval;
      timeoutId = setTimeout(() => {
        void refetch();
        intervalId = setInterval(() => void refetch(), pollInterval);
      }, delay);
    };

    if (pollInterval > 0) {
      intervalId = setInterval(() => void refetch(), pollInterval);
    }

    const onFocus = () => {
      if (refetchOnFocus && typeof document !== "undefined" && document.visibilityState === "visible") {
        void refetch();
      }
    };

    if (refetchOnFocus && typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onFocus);
    }

    return () => {
      abortRef.current?.abort();
      if (intervalId !== undefined) clearInterval(intervalId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (refetchOnFocus && typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onFocus);
      }
    };
  }, [enabled, pollInterval, maxBackoffMs, refetchOnFocus, refetch]);

  return { data, isLoading, error, refetch };
}

/** Alias for {@link useAsyncResource}. */
export const usePolling = useAsyncResource;

/** Refetch when the window regains focus (no polling). */
export function useRefetchOnFocus(
  refetch: () => void | Promise<void>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onFocus = () => {
      if (document.visibilityState === "visible") void refetch();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetch, enabled]);
}