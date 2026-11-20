import { useEffect, useRef, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { isMuxedAddress } from "@lumen/core";

export interface DebouncedAddressValidationResult {
  value: string;
  setValue: (next: string) => void;
  error: string | null;
  validating: boolean;
  isValid: boolean;
}

export interface UseDebouncedAddressValidationOptions {
  debounceMs?: number;
  federationResolver?: (domain: string, signal: AbortSignal) => Promise<string>;
}

export function useDebouncedAddressValidation(
  initial = "",
  options: UseDebouncedAddressValidationOptions = {},
): DebouncedAddressValidationResult {
  const { debounceMs = 300, federationResolver } = options;
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(null);
      setIsValid(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      void (async () => {
        setValidating(true);
        try {
          if (StrKey.isValidEd25519PublicKey(trimmed) || isMuxedAddress(trimmed)) {
            setError(null);
            setIsValid(true);
            return;
          }
          if (trimmed.includes("*") && federationResolver) {
            const [name, domain] = trimmed.split("*");
            const resolved = await federationResolver(
              `${name}*${domain}`,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (!StrKey.isValidEd25519PublicKey(resolved)) {
              throw new Error("Federation did not return a valid address");
            }
            setError(null);
            setIsValid(true);
            return;
          }
          setError("Enter a valid G-address, M-address, or federation address");
          setIsValid(false);
        } catch (err) {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
          setIsValid(false);
        } finally {
          if (!controller.signal.aborted) setValidating(false);
        }
      })();
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, debounceMs, federationResolver]);

  return { value, setValue, error, validating, isValid };
}