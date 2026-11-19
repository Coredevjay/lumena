import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Wallet } from "@lumen/core";
import { useLumen } from "./context.js";

export interface UseWalletResult {
  wallet: Wallet | undefined;
  error: Error | null;
  refetch: () => void;
}

export function useWallet(walletId: string): UseWalletResult {
  const { client, store } = useLumen();

  const [error, setError] = useState<Error | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store]
  );

  const getSnapshot = useCallback(
    () => store.getWallet(walletId),
    [store, walletId]
  );

  const wallet = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refetch = useCallback(() => {
    try {
      setError(null);
      store.setWallet(walletId, client.getWallet(walletId));
    } catch (error) {
      setError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }, [client, store, walletId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    wallet,
    error,
    refetch,
  };
}