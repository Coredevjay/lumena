import { useCallback } from "react";
import { useAsyncResource } from "./use-async-resource.js";

export interface SponsorStatus {
  balance: number;
  currency: string;
  active: boolean;
  [key: string]: unknown;
}

export interface UseSponsorStatusOptions {
  /** Polling interval in milliseconds. Defaults to 30000 (30s). Set to 0 to disable polling. */
  pollInterval?: number;
  /** Base URL for the Lumen API. Defaults to the relative `/sponsor/status` path. */
  baseUrl?: string;
  /** Optional fetch implementation override (useful for tests). */
  fetcher?: typeof fetch;
}

export interface UseSponsorStatusResult {
  status: SponsorStatus | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL = 30_000;

export function useSponsorStatus(
  options: UseSponsorStatusOptions = {},
): UseSponsorStatusResult {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    baseUrl = "",
    fetcher,
  } = options;

  const fetchStatus = useCallback(
    async (_signal: AbortSignal): Promise<SponsorStatus> => {
      const doFetch = fetcher ?? fetch;
      const response = await doFetch(`${baseUrl}/sponsor/status`, { signal: _signal });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch sponsor status: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as SponsorStatus;
    },
    [baseUrl, fetcher],
  );

  const { data, isLoading, error, refetch } = useAsyncResource({
    fetcher: fetchStatus,
    pollInterval,
    refetchOnFocus: true,
  });

  return {
    status: data ?? null,
    isLoading,
    error,
    refetch,
  };
}