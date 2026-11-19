import { Networks } from "@stellar/stellar-sdk";

/**
 * Supported Stellar network identifiers.
 */
export type StellarNetwork = "testnet" | "public" | "futurenet" | "local";

/**
 * Typed configuration describing a Stellar network and its endpoints.
 */
export interface NetworkConfig {
  /** Canonical network identifier. */
  network: StellarNetwork;
  /** Horizon endpoint for the network. */
  horizonUrl: string;
  /** Soroban RPC endpoint for the network. */
  rpcUrl: string;
  /** Network passphrase used to sign transactions. */
  networkPassphrase: string;
}

/**
 * Stellar Testnet configuration.
 */
export const TESTNET: NetworkConfig = {
  network: "testnet",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
};

/**
 * Stellar Public (mainnet) configuration.
 */
export const PUBLIC: NetworkConfig = {
  network: "public",
  horizonUrl: "https://horizon.stellar.org",
  rpcUrl: "https://soroban.stellar.org",
  networkPassphrase: Networks.PUBLIC,
};

/**
 * Stellar Futurenet configuration.
 */
export const FUTURENET: NetworkConfig = {
  network: "futurenet",
  horizonUrl: "https://horizon-futurenet.stellar.org",
  rpcUrl: "https://rpc-futurenet.stellar.org",
  networkPassphrase: Networks.FUTURENET,
};

/**
 * Local (standalone) network configuration.
 */
export const LOCAL: NetworkConfig = {
  network: "local",
  horizonUrl: "http://localhost:8000",
  rpcUrl: "http://localhost:8000/soroban/rpc",
  networkPassphrase: Networks.STANDALONE,
};

/**
 * All known network configurations keyed by identifier.
 */
export const NETWORKS: Record<StellarNetwork, NetworkConfig> = {
  testnet: TESTNET,
  public: PUBLIC,
  futurenet: FUTURENET,
  local: LOCAL,
};

/**
 * Resolve a network from a name, a passphrase, or a config object.
 *
 * @param input A network name (e.g. `"testnet"`), a network passphrase,
 *   or an existing {@link NetworkConfig}.
 * @returns The matching {@link NetworkConfig}.
 * @throws If the input cannot be resolved to a known network.
 */
export function resolveNetwork(input: StellarNetwork | string | NetworkConfig): NetworkConfig {
  if (typeof input === "object" && input !== null) {
    return input;
  }

  if (typeof input !== "string") {
    throw new Error(`Invalid network input: ${String(input)}`);
  }

  const normalized = input.trim().toLowerCase();

  // Match by network name.
  if (normalized in NETWORKS) {
    return NETWORKS[normalized as StellarNetwork];
  }

  // Match by network passphrase.
  for (const config of Object.values(NETWORKS)) {
    if (config.networkPassphrase === input) {
      return config;
    }
  }

  throw new Error(`Unknown network: ${input}`);
}