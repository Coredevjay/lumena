import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fee estimate returned by the core fee estimator.
 *
 * Sponsored vs unsponsored display:
 * - When `sponsored` is `true`, the transaction fee is paid by a sponsor and
 *   consumers should display the fee as "Sponsored" (or hide the amount)
 *   rather than showing `fee` as a cost to the user.
 * - When `sponsored` is `false`, display `fee` as the amount the user pays.
 * - `surge` indicates the current fee is higher than usual and should be
 *   surfaced with a "fees are higher than usual" indicator.
 */
export interface FeeEstimate {
  /** Estimated fee amount in the smallest unit (e.g. stroops). */
  fee: string;
  /** Whether the current fee is higher than the typical baseline. */
  surge: boolean;
  /** Whether the transaction fee is covered by a sponsor. */
  sponsored: boolean;
}

export interface UseFeeEstimateOptions {
  /**
   * Function that fetches the current fee estimate from the core estimator.
   * Required so the hook stays transport-agnostic.
   */
  estimate: () => Promise<FeeEstimate>;
  /** Polling interval in milliseconds. Defaults to 10000. Set to 0 to disable polling. */
  pollInterval?: number;
  /** Whether polling is enabled. Defaults to true. */
  enabled?: boolean;
}

export interface UseFeeEstimateResult {
  /** Latest fee estimate, or `null` before the first successful fetch. */
  estimate: FeeEstimate | null;
  /** Convenience flag: `true` when the latest estimate is in surge. */
  surge: boolean;
  /** `true` while a fetch is in flight (including the initial fetch). */
  loading: boolean;
  /** Last error encountered, or `null`. */
  error: Error | null;
  /** Manually trigger a refresh. */
  refresh: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL = 10000;

/**
 * Polls a fee estimator and exposes the current fee, a `surge` flag, and
 * loading/error state.
 */
export function useFeeEstimate(options: UseFeeEstimateOptions): UseFeeEstimateResult {
  const { estimate: fetchEstimate, pollInterval = DEFAULT_POLL_INTERVAL, enabled = true } = options;

  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const fetchRef = useRef(fetchEstimate);
  fetchRef.current = fetchEstimate;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchRef.current();
      if (!mountedRef.current) return;
      setEstimate(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      await refresh();
      if (cancelled || pollInterval <= 0) return;
      timer = setTimeout(run, pollInterval);
    };

    void run();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [enabled, pollInterval, refresh]);

  return {
    estimate,
    surge: estimate?.surge ?? false,
    loading,
    error,
    refresh,
  };
}