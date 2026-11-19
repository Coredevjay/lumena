"use client";

import { useEffect, useState } from "react";
import type { AssetFlags } from "@lumen/core";
import { useLumen } from "./context.js";

export interface UseAssetFlagsResult {
  flags: AssetFlags | undefined;
  /** User-facing warnings for auth-required, revocable or clawback-enabled assets. */
  warnings: string[];
  loading: boolean;
  error: Error | null;
}

/**
 * Reads an asset's issuer flags so swap/send flows can warn before the user
 * transacts in an auth-required or clawback-enabled asset.
 */
export function useAssetFlags(assetCode: string | undefined): UseAssetFlagsResult {
  const { client } = useLumen();

  const [flags, setFlags] = useState<AssetFlags>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(assetCode));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!assetCode) {
      setFlags(undefined);
      setWarnings([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    client
      .getAssetFlags(assetCode)
      .then((result) => {
        if (cancelled) return;
        setFlags(result.flags);
        setWarnings(result.warnings);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, assetCode]);

  return { flags, warnings, loading, error };
}
