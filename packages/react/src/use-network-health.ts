import { useCallback } from 'react';
import { useLumenClient } from './context';
import { useAsyncResource } from './use-async-resource.js';

export type NetworkHealthStatus = 'healthy' | 'degraded' | 'offline';

export interface NetworkHealthPing {
  latencyMs: number;
  ledgerNumber: number;
}

export interface UseNetworkHealthOptions {
  pollInterval?: number;
  rpcUrl?: string;
  fetcher?: typeof fetch;
  ping?: () => Promise<NetworkHealthPing>;
}

export interface UseNetworkHealthResult {
  status: NetworkHealthStatus;
  latencyMs: number;
  ledgerNumber: number;
  error: Error | null;
  refetch: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL = 15_000;

export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';

export const DEGRADED_LATENCY_THRESHOLD_MS = 2500;

interface ProbeSnapshot {
  status: NetworkHealthStatus;
  latencyMs: number;
  ledgerNumber: number;
}

async function defaultPing(
  rpcUrl: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<NetworkHealthPing> {
  const started = Date.now();

  const response = await fetcher(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestLedger',
      params: {},
    }),
    signal,
  });

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    throw new Error(
      `Network health probe failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    result?: { sequence?: number; ledger?: number };
  };

  return {
    latencyMs,
    ledgerNumber: payload?.result?.sequence ?? payload?.result?.ledger ?? 0,
  };
}

function toSnapshot(ping: NetworkHealthPing): ProbeSnapshot {
  return {
    latencyMs: ping.latencyMs,
    ledgerNumber: ping.ledgerNumber,
    status:
      ping.latencyMs > DEGRADED_LATENCY_THRESHOLD_MS ? 'degraded' : 'healthy',
  };
}

export function useNetworkHealth(
  options: UseNetworkHealthOptions = {},
): UseNetworkHealthResult {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    rpcUrl: rpcUrlOption,
    fetcher,
    ping,
  } = options;

  const client = useLumenClient();
  const rpcUrl = rpcUrlOption ?? client?.rpcUrl ?? DEFAULT_RPC_URL;

  const probe = useCallback(
    async (signal: AbortSignal): Promise<ProbeSnapshot> => {
      try {
        const result = ping
          ? await ping()
          : await defaultPing(rpcUrl, fetcher ?? fetch, signal);
        return toSnapshot(result);
      } catch {
        return { status: 'offline', latencyMs: 0, ledgerNumber: 0 };
      }
    },
    [ping, rpcUrl, fetcher],
  );

  const { data, error, refetch } = useAsyncResource({
    fetcher: probe,
    pollInterval,
    refetchOnFocus: true,
  });

  const snapshot = data ?? {
    status: 'offline' as NetworkHealthStatus,
    latencyMs: 0,
    ledgerNumber: 0,
  };

  return {
    status: snapshot.status,
    latencyMs: snapshot.latencyMs,
    ledgerNumber: snapshot.ledgerNumber,
    error,
    refetch,
  };
}