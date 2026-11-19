export type StellarNetwork = "testnet" | "mainnet" | "local" | "futurenet";

export interface SignerConfig {
  publicKey: string;
  weight: number;
}

export interface TransactionResult {
  hash: string;
  ledger: number;
  success: boolean;
  error?: string;
}

/**
 * Network configuration describing the endpoints and passphrase for a
 * Stellar network. This is the canonical shape reused by the core
 * `networks.ts` module and downstream packages.
 */
export interface NetworkConfig {
  network: StellarNetwork;
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Stellar configuration. Kept structurally compatible with
 * `NetworkConfig` so downstream packages can import either type from
 * `@lumen/types`.
 */
export interface StellarConfig extends NetworkConfig {}