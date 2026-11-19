"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLumen } from "./context.js";

export interface UseBalanceResult {
  balance: string | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const DEFAULT_REFRESH_INTERVAL = 10_000;

interface BalanceState {
  balance: string | undefined;
  loading: boolean;
  error: Error | null;
}

interface BalanceStore {
  getState: () => BalanceState;
  subscribe: (listener: () => void) => () => void;
  setState: (next: Partial<BalanceState>) => void;
}

function createBalanceStore(): BalanceStore {
  let state: BalanceState = {
    balance: undefined,
    loading: true,
    error: null,
  };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (next) => {
      state = { ...state, ...next };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export function useBalance(
  walletId: string,
  assetCode?: string,
  refreshInterval = DEFAULT_REFRESH_INTERVAL
): UseBalanceResult {
  const { client } = useLumen();

  const store = useMemo(() => createBalanceStore(), []);

  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  );

  const refetch = useCallback(async () => {
    store.setState({ loading: true, error: null });

    try {
      const nextBalance = await client.getBalance(walletId, assetCode);
      store.setState({ balance: nextBalance });
    } catch (error) {
      store.setState({
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      store.setState({ loading: false });
    }
  }, [client, walletId, assetCode, store]);

  useEffect(() => {
    void refetch();

    if (refreshInterval <= 0) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refetch();
    }, refreshInterval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refetch, refreshInterval]);

  return {
    balance: state.balance,
    loading: state.loading,
    error: state.error,
    refetch,
  };
}