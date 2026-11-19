import { FUTURENET, PUBLIC, TESTNET } from '@lumen/core';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

export type EndpointKind = 'horizon' | 'soroban';

export interface StellarEndpoint {
  url: string;
  kind: EndpointKind;
  region?: string;
}

export interface EndpointStatus {
  url: string;
  kind: EndpointKind;
  region?: string;
  healthy: boolean;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
}

export type StellarNetworkName = 'mainnet' | 'testnet' | 'futurenet';

/**
 * Per-tenant network configuration. Allows a single server instance to serve
 * tenants on different Stellar networks by resolving horizon/rpc/passphrase
 * (and optionally sponsor) per tenant/API key.
 */
export interface StellarNetworkConfig {
  network: StellarNetworkName;
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
  sponsor?: string;
}

export interface FailoverStellarClientOptions {
  endpoints?: StellarEndpoint[];
  network?: StellarNetworkName;
  /** Explicit per-tenant network config; takes precedence over `network`. */
  networkConfig?: StellarNetworkConfig;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export const NETWORK_PRESETS: Record<StellarNetworkName, StellarNetworkConfig> = {
  mainnet: {
    network: 'mainnet',
    horizonUrl: PUBLIC.horizonUrl,
    rpcUrl: PUBLIC.rpcUrl,
    networkPassphrase: PUBLIC.networkPassphrase,
  },
  testnet: {
    network: 'testnet',
    horizonUrl: TESTNET.horizonUrl,
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  },
  futurenet: {
    network: 'futurenet',
    horizonUrl: FUTURENET.horizonUrl,
    rpcUrl: FUTURENET.rpcUrl,
    networkPassphrase: FUTURENET.networkPassphrase,
  },
};

/** Resolve a network config by name, falling back to testnet. */
export function resolveNetworkConfig(
  network?: StellarNetworkName | StellarNetworkConfig,
): StellarNetworkConfig {
  if (network && typeof network === 'object') return network;
  return NETWORK_PRESETS[network ?? 'testnet'] ?? NETWORK_PRESETS.testnet;
}

/** Build endpoint list from a per-tenant network config. */
export function endpointsFromNetworkConfig(config: StellarNetworkConfig): StellarEndpoint[] {
  return [
    { url: config.horizonUrl, kind: 'horizon', region: 'global' },
    { url: config.rpcUrl, kind: 'soroban', region: 'global' },
  ];
}

const DEFAULT_PROBE_INTERVAL_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 3;

interface InternalEndpointState {
  endpoint: StellarEndpoint;
  healthy: boolean;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
}

export interface StellarRequestOptions {
  kind?: EndpointKind;
  method?: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
  maxRetries?: number;
}

export class FailoverStellarClient {
  private readonly states: InternalEndpointState[];
  private readonly probeIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly networkConfig: StellarNetworkConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;

  constructor(opts: FailoverStellarClientOptions = {}) {
    this.networkConfig = resolveNetworkConfig(opts.networkConfig ?? opts.network);
    const endpoints =
      opts.endpoints && opts.endpoints.length > 0
        ? opts.endpoints
        : endpointsFromNetworkConfig(this.networkConfig);

    this.states = endpoints.map((endpoint) => ({
      endpoint,
      healthy: true,
      latencyMs: null,
      lastCheckedAt: null,
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
    }));

    this.probeIntervalMs = opts.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = opts.fetchImpl ?? fetch;

    this.updateGauges();
  }

  start(): void {
    if (this.timer) return;
    void this.probeAll();
    this.timer = setInterval(() => {
      void this.probeAll();
    }, this.probeIntervalMs);
    if (typeof this.timer === 'object' && this.timer !== null && 'unref' in this.timer) {
      (this.timer as { unref?: () => void }).unref?.();
    }
    logger.info('FailoverStellarClient started', {
      network: this.networkConfig.network,
      endpoints: this.states.length,
      probeIntervalMs: this.probeIntervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('FailoverStellarClient stopped');
  }

  /** The per-tenant network config this client is scoped to. */
  getNetworkConfig(): StellarNetworkConfig {
    return this.networkConfig;
  }

  getEndpointStatus(): EndpointStatus[] {
    return this.states.map((s) => ({
      url: s.endpoint.url,
      kind: s.endpoint.kind,
      region: s.endpoint.region,
      healthy: s.healthy,
      latencyMs: s.latencyMs,
      lastCheckedAt: s.lastCheckedAt,
      consecutiveFailures: s.consecutiveFailures,
      totalRequests: s.totalRequests,
      totalFailures: s.totalFailures,
    }));
  }

  async probeAll(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      await Promise.all(this.states.map((s) => this.probeEndpoint(s)));
    } finally {
      this.probing = false;
      this.updateGauges();
    }
  }

  private async probeEndpoint(state: InternalEndpointState): Promise<void> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      const probeUrl =
        state.endpoint.kind === 'horizon'
          ? `${state.endpoint.url.replace(/\/$/, '')}/`
          : state.endpoint.url;
      const res = await this.fetchImpl(probeUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      const latency = Date.now() - started;
      state.latencyMs = latency;
      state.lastCheckedAt = Date.now();
      if (res.ok || res.status === 404 || res.status === 405) {
        state.healthy = true;
        state.consecutiveFailures = 0;
        metrics.observeStellarEndpointLatency(state.endpoint.url, latency);
      } else {
        state.healthy = false;
        state.consecutiveFailures += 1;
        metrics.incrementStellarEndpointProbeFailure(state.endpoint.url);
        logger.warn('Stellar endpoint probe returned non-OK status', {
          url: state.endpoint.url,
          status: res.status,
        });
      }
    } catch (err) {
      state.lastCheckedAt = Date.now();
      state.healthy = false;
      state.consecutiveFailures += 1;
      metrics.incrementStellarEndpointProbeFailure(state.endpoint.url);
      logger.warn('Stellar endpoint probe failed', {
        url: state.endpoint.url,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private updateGauges(): void {
    const healthy = this.states.filter((s) => s.healthy).length;
    metrics.setStellarHealthyEndpoints(healthy);
    metrics.setStellarTotalEndpoints(this.states.length);
  }

  private rankCandidates(kind?: EndpointKind): InternalEndpointState[] {
    const pool = kind ? this.states.filter((s) => s.endpoint.kind === kind) : this.states.slice();
    return pool.sort((a, b) => {
      if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
      const aLat = a.latencyMs ?? Number.POSITIVE_INFINITY;
      const bLat = b.latencyMs ?? Number.POSITIVE_INFINITY;
      if (aLat !== bLat) return aLat - bLat;
      return a.consecutiveFailures - b.consecutiveFailures;
    });
  }

  async request<T = unknown>(options: StellarRequestOptions = {}): Promise<T> {
    const candidates = this.rankCandidates(options.kind);
    if (candidates.length === 0) {
      throw new Error('No Stellar endpoints configured');
    }

    const maxRetries = options.maxRetries ?? this.maxRetries;
    const attempts = Math.min(candidates.length, Math.max(1, maxRetries));
    let lastError: unknown = null;

    for (let i = 0; i < attempts; i++) {
      const state = candidates[i];
      const url = this.buildUrl(state, options);
      state.totalRequests += 1;
      metrics.incrementStellarRequest(state.endpoint.url);
      try {
        const res = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          headers: {
            accept: 'application/json',
            ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(options.headers ?? {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });

        if (!res.ok) {
          throw new Error(`Stellar endpoint ${state.endpoint.url} responded ${res.status}`);
        }

        state.healthy = true;
        state.consecutiveFailures = 0;
        const data = (await res.json()) as T;
        return data;
      } catch (err) {
        lastError = err;
        state.totalFailures += 1;
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= 2) {
          state.healthy = false;
        }
        metrics.incrementStellarRequestFailure(state.endpoint.url);
        metrics.incrementStellarFailover();
        logger.warn('Stellar request failed, attempting failover', {
          url: state.endpoint.url,
          attempt: i + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.updateGauges();
    throw lastError instanceof Error
      ? lastError
      : new Error('All Stellar endpoints failed');
  }

  private buildUrl(state: InternalEndpointState, options: StellarRequestOptions): string {
    const base = state.endpoint.url.replace(/\/$/, '');
    const path = options.path ?? '';
    if (!path) return base;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

export default FailoverStellarClient;