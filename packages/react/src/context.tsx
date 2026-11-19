"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LumenClient } from "@lumen/web-sdk";
import { FUTURENET, PUBLIC, TESTNET } from "@lumen/core";
import { useIsMounted } from "./hooks/use-is-mounted.js";

/**
 * Stellar networks a `LumenProvider` can switch between. Derived from the
 * canonical network constants in `@lumen/core` so the React package never
 * hardcodes network names.
 */
export type LumenNetwork = typeof TESTNET | typeof FUTURENET | typeof PUBLIC;

export const DEFAULT_SUPPORTED_NETWORKS: LumenNetwork[] = [TESTNET, FUTURENET, PUBLIC];

export interface LumenContextValue {
  /** Client bound to `currentNetwork`. Changes identity when the network is switched. */
  client: LumenClient;
  /**
   * `true` once the provider has mounted on the client, `false` during
   * server-side rendering and hydration. Gate browser-only APIs
   * (`window.crypto`, `navigator.credentials`, …) behind this flag together
   * with `typeof window !== "undefined"` to avoid
   * `ReferenceError: window is not defined` on the server.
   */
  isMounted: boolean;
  /** The network the active `client` is connected to. */
  currentNetwork: LumenNetwork;
  /** Networks that `switchNetwork` accepts. */
  supportedNetworks: LumenNetwork[];
  /**
   * Switches the active network. Every hook reading `client` from this
   * context (`useBalance`, `useWallet`, …) refetches against the new network.
   */
  switchNetwork: (network: LumenNetwork) => void;
}

export const LumenContext = createContext<LumenContextValue | null>(null);

/**
 * Mutable provider state. Kept in a small external store so that consumers
 * can subscribe to individual slices via `useSyncExternalStore` and only
 * re-render when the slice they read changes.
 */
export interface LumenState {
  isMounted: boolean;
  currentNetwork: LumenNetwork;
  supportedNetworks: LumenNetwork[];
}

type Listener = () => void;

export interface LumenStore {
  getState: () => LumenState;
  setState: (patch: Partial<LumenState>) => void;
  subscribe: (listener: Listener) => () => void;
}

/**
 * Creates a minimal external store. `setState` performs a shallow merge and
 * only notifies listeners when at least one value actually changed, so
 * identical updates never trigger re-renders.
 */
export function createLumenStore(initial: LumenState): LumenStore {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof LumenState)[]) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }
      state = { ...state, ...patch };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Subscribes to a single slice of the provider state. The component only
 * re-renders when the selected value changes (compared with `Object.is`).
 */
export function useLumenSelector<T>(store: LumenStore, selector: (state: LumenState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

/** Stable context holding only the active `LumenClient` instance. */
export const LumenClientContext = createContext<LumenClient | null>(null);

/** Context carrying the external store for mutable provider state. */
export const LumenStoreContext = createContext<LumenStore | null>(null);

/**
 * `true` when running in a browser environment. Safe to evaluate during
 * React Server Component rendering because it never touches `window`
 * directly until the guard passes.
 */
export function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Creates a proxy that stands in for a `LumenClient` on the server. Any
 * property access or invocation throws a clear error explaining that a
 * browser environment is required, instead of failing with an opaque
 * `ReferenceError` or `TypeError` during RSC rendering.
 */
function createServerSafeClientProxy(): LumenClient {
  const thrower = (): never => {
    throw new Error(
      "@lumen/react: LumenClient requires a browser environment. " +
        "Render Lumen components inside a client component (\"use client\") " +
        "or use LumenServerProvider during React Server Component rendering.",
    );
  };

  return new Proxy({} as LumenClient, {
    get(_target, prop) {
      // Allow introspection helpers to behave sanely without throwing.
      if (prop === "then") {
        return undefined;
      }
      if (prop === Symbol.toStringTag) {
        return "LumenServerSafeClient";
      }
      if (typeof prop === "symbol") {
        return undefined;
      }
      return thrower;
    },
    apply() {
      return thrower();
    },
  });
}

/**
 * Server-safe fallback context value. `isMounted` is always `false` and the
 * `client` is a proxy that throws a descriptive error if used. This value is
 * safe to construct during RSC rendering and produces no hydration mismatch
 * because it matches the pre-mount client state.
 */
export const serverSafeLumenContextValue: LumenContextValue = {
  client: createServerSafeClientProxy(),
  isMounted: false,
  currentNetwork: TESTNET,
  supportedNetworks: [TESTNET],
  switchNetwork: () => {},
};

export interface LumenProviderProps {
  /** Client connected to the initial `network`. */
  client: LumenClient;
  /** Network the provided `client` is connected to. Defaults to "testnet". */
  network?: LumenNetwork;
  /**
   * Networks the user may switch to. Defaults to all networks when
   * `createClient` is provided, otherwise only the initial `network`.
   */
  supportedNetworks?: LumenNetwork[];
  /**
   * Factory used to create a client for a network other than the initial
   * one. Clients are created lazily on first switch and cached.
   */
  createClient?: (network: LumenNetwork) => LumenClient;
  /**
   * BCP-47 locale code used to translate all prebuilt Lumen UI components.
   * Supported values: "en" | "es" | "pt" | "fr" | "ja"
   * Defaults to "en".
   */
  locale?: LumenLocale;
  children: React.ReactNode;
}

export function LumenProvider({
  client,
  network = TESTNET,
  supportedNetworks,
  createClient,
  locale = "en",
  children,
}: LumenProviderProps) {
  const isMounted = useIsMounted();
  const [currentNetwork, setCurrentNetwork] = useState<LumenNetwork>(network);
  const clientsRef = useRef(new Map<LumenNetwork, LumenClient>());

  const networks = supportedNetworks ?? (createClient ? DEFAULT_SUPPORTED_NETWORKS : [network]);

  const storeRef = useRef<LumenStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createLumenStore({
      isMounted: false,
      currentNetwork: network,
      supportedNetworks: networks,
    });
  }
  const store = storeRef.current;

  // Keep the external store in sync with props and mount state. `setState`
  // is a no-op when nothing changed, so this never causes spurious renders.
  store.setState({ isMounted, currentNetwork, supportedNetworks: networks });

  const activeClient = useMemo(() => {
    if (currentNetwork === network || !createClient) {
      return client;
    }
    let networkClient = clientsRef.current.get(currentNetwork);
    if (!networkClient) {
      networkClient = createClient(currentNetwork);
      clientsRef.current.set(currentNetwork, networkClient);
    }
    return networkClient;
  }, [client, network, currentNetwork, createClient]);

  const switchNetwork = useCallback(
    (next: LumenNetwork) => {
      if (!networks.includes(next)) {
        throw new Error(
          `@lumen/react: Network "${next}" is not supported. ` +
            `Supported networks: ${networks.join(", ")}`,
        );
      }
      if (next !== network && !createClient) {
        throw new Error(
          `@lumen/react: Cannot switch to "${next}" without a createClient prop on LumenProvider.`,
        );
      }
      setCurrentNetwork(next);
    },
    [networks, network, createClient],
  );

  // On the server, expose the server-safe proxy so browser crypto / WebAuthn
  // calls fail with a descriptive error instead of a `ReferenceError`.
  const safeClient = isBrowserEnvironment() ? activeClient : serverSafeLumenContextValue.client;

  // Backwards-compatible combined value for `useLumen()` consumers. It is
  // memoised so it only changes when one of its inputs changes.
  const contextValue = useMemo<LumenContextValue>(
    () => ({
      client: safeClient,
      isMounted,
      currentNetwork,
      supportedNetworks: networks,
      switchNetwork,
    }),
    [safeClient, isMounted, currentNetwork, networks, switchNetwork],
  );

  return (
    <LumenStoreContext.Provider value={store}>
      <LumenClientContext.Provider value={safeClient}>
        <LumenContext.Provider value={contextValue}>{children}</LumenContext.Provider>
      </LumenClientContext.Provider>
    </LumenStoreContext.Provider>
  );
}

export interface LumenServerProviderProps {
  /**
   * Optional client to expose on the server. When omitted, a server-safe
   * proxy is used that throws a descriptive error if any method is invoked.
   */
  client?: LumenClient;
  /** Network to report during server rendering. Defaults to "testnet". */
  network?: LumenNetwork;
  children: React.ReactNode;
}

/**
 * Server-safe mock provider for React Server Components. It supplies a
 * context value with `isMounted: false` so that components render their
 * pre-hydration state on the server, avoiding hydration mismatches. It never
 * accesses browser globals.
 */
export function LumenServerProvider({
  client,
  network = TESTNET,
  children,
}: LumenServerProviderProps) {
  const value: LumenContextValue = {
    ...serverSafeLumenContextValue,
    client: client ?? serverSafeLumenContextValue.client,
    isMounted: false,
    currentNetwork: network,
    supportedNetworks: [network],
  };

  return (
    <LumenContext.Provider value={value}>{children}</LumenContext.Provider>
  );
}

export function useLumen(): LumenContextValue {
  const context = useContext(LumenContext);

  if (!context) {
    throw new Error("useLumen must be used within a LumenProvider");
  }

  return context;
}

/**
 * Returns the active `LumenClient` from the stable client context. Components
 * using this hook do not re-render when unrelated provider state (such as
 * `isMounted`) changes.
 */
export function useLumenClient(): LumenClient {
  const client = useContext(LumenClientContext);
  if (!client) {
    throw new Error("useLumenClient must be used within a LumenProvider");
  }
  return client;
}

/**
 * Reads a single slice of provider state through the external store. Only
 * re-renders when the selected value changes.
 */
export function useLumenState<T>(selector: (state: LumenState) => T): T {
  const store = useContext(LumenStoreContext);
  if (!store) {
    throw new Error("useLumenState must be used within a LumenProvider");
  }
  return useLumenSelector(store, selector);
}