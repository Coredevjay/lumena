import { Buffer } from "buffer";
import {
  installCryptoProvider,
  type CryptoProvider,
} from "@lumen/core";

/**
 * Installs react-native-quick-crypto's WebCrypto-compatible API globally
 * and registers it with the shared @lumen/core crypto adapter.
 *
 * Call this once from the app entry point before using Lumen key management.
 */
export function installNativeCrypto(): void {
  // Lazily require so that bundlers targeting web don't eagerly pull in
  // the native module unless this function is actually invoked.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const quickCrypto = require("react-native-quick-crypto") as {
    install: () => void;
  };
  quickCrypto.install();

  const nativeGlobal = globalThis as typeof globalThis & {
    Buffer?: typeof Buffer;
  };
  nativeGlobal.Buffer ??= Buffer;

  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.getRandomValues !== "function" ||
    typeof globalThis.crypto.subtle === "undefined"
  ) {
    throw new Error(
      "@lumen/react-native: react-native-quick-crypto did not install WebCrypto.",
    );
  }

  // Register the installed WebCrypto implementation with the shared
  // adapter so all @lumen/core consumers use the same provider.
  const provider: CryptoProvider = {
    subtle: globalThis.crypto.subtle,
    getRandomValues: <T extends ArrayBufferView | null>(
      array: T,
    ): T => globalThis.crypto.getRandomValues(array as ArrayBufferView) as T,
  };
  installCryptoProvider(provider);
}