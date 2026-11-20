"use client";

import { useBalance, type UseBalanceResult } from "./use-balance.js";

function balanceResource(
  walletId: string,
  assetCode?: string,
): UseBalanceResult & { read: () => string | undefined } {
  const state = useBalance(walletId, assetCode);
  if (state.loading) {
    throw new Promise<void>((resolve) => {
      const check = () => {
        if (!state.loading) resolve();
        else requestAnimationFrame(check);
      };
      void state.refetch().finally(() => resolve());
      check();
    });
  }
  if (state.error) throw state.error;
  return { ...state, read: () => state.balance };
}

export function useBalanceSuspense(
  walletId: string,
  assetCode?: string,
): string | undefined {
  return balanceResource(walletId, assetCode).read();
}

export interface UseBalanceOptions {
  suspense?: boolean;
}

export function useWalletBalance(
  walletId: string,
  assetCode?: string,
  options?: UseBalanceOptions,
): UseBalanceResult | string | undefined {
  if (options?.suspense) {
    return useBalanceSuspense(walletId, assetCode);
  }
  return useBalance(walletId, assetCode);
}